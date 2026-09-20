package main

import "time"

// The delivery loop breaker used to open a five minute cooldown the moment one reverse delivery
// happened inside a minute. That punishes exactly the wrong thing: a fast model finishes two or three
// exchanges in five minutes and gets frozen, while a slow model never finishes one exchange in the
// window and is never touched. The breaker exists to stop two unattended agents answering each other
// in a tight loop, and that is a *rate* problem, not a single-event problem - so it becomes a budget:
// a few reverse deliveries per window are ordinary collaboration, and only going past the budget is a
// loop. The cooldown also starts short and only escalates if the pair reoffends straight after it.
//
// This file holds the decision only; the guard in app_agent_delivery.go still does the timing.

const (
	// A reverse delivery is one conversation answering a delivery it received.
	loopBudgetWindow = 60 * time.Second
)

// loopBudgetConfig is the tunable part: how many reverse deliveries a window allows, and how long to
// freeze the pair once they exceed it. Keeping the first cooldown short matters more than the repeat
// one: an honest back-and-forth that overshoots loses a minute, not five.
type loopBudgetConfig struct {
	Allow          int
	FirstCooldown  time.Duration
	RepeatCooldown time.Duration
	Window         time.Duration
}

// loopBudgetLevels is the three-way setting. There is deliberately no "off": the breaker protects
// against two agents that will never stop on their own.
// loopBudgetLevels is the three-way setting. There is deliberately no "off": the breaker exists to
// stop two agents that will never stop on their own.
//
// Standard is 8 because of how the guard counts: every *alternation* is a reversal, so an ordinary
// "reply, answer, one clarification" already produces 4-6 of them - a budget of 3 fires on ordinary
// collaboration, which is exactly the trap the reader hit. A genuine unattended ping-pong runs at about
// one per second and blows past 8 immediately, and two other guards still apply
// (agentDeliverySourceBurst = 12 per 10s across targets, and the 4000 character cap per message), so 8
// can be generous here without letting a flood through.
//   strict  3 / 60s, first cooldown 60s - for people who do not want fast automatic round trips
//   loose  20 / 60s, first cooldown 30s - for several agents collaborating densely
var loopBudgetLevels = map[string]loopBudgetConfig{
	"strict":   {Allow: 3, FirstCooldown: 60 * time.Second, RepeatCooldown: 5 * time.Minute, Window: loopBudgetWindow},
	"standard": {Allow: 8, FirstCooldown: 60 * time.Second, RepeatCooldown: 5 * time.Minute, Window: loopBudgetWindow},
	"loose":    {Allow: 20, FirstCooldown: 30 * time.Second, RepeatCooldown: 5 * time.Minute, Window: loopBudgetWindow},
}

// loopBudgetConfigFor falls back to the standard level for anything unknown, so a bad stored value
// cannot silently disable the breaker.
func loopBudgetConfigFor(level string) loopBudgetConfig {
	if config, ok := loopBudgetLevels[level]; ok {
		return config
	}
	return loopBudgetLevels["standard"]
}

// loopBudgetState is the whole memory of the breaker for one ordered pair of conversations.
type loopBudgetState struct {
	windowStart time.Time
	reverse     int
	openUntil   time.Time
	// strikes counts cooldowns that have already been served, which is what escalates the next one.
	strikes int
}

// loopBudgetDecision is what the guard needs to answer a delivery: whether it may proceed, and if not,
// how much of the cooldown is left for the message.
type loopBudgetDecision struct {
	Allowed   bool
	Remaining time.Duration
}

// decideLoopBudget records one reverse delivery and returns the refreshed state with the verdict.
// A forward delivery never reaches here - only a reverse one can build a loop.
func decideLoopBudget(state loopBudgetState, config loopBudgetConfig, now time.Time) (loopBudgetState, loopBudgetDecision) {
	window := config.Window
	if window <= 0 {
		window = loopBudgetWindow
	}
	// Still inside a cooldown: report it and do not move the budget.
	if !state.openUntil.IsZero() && now.Before(state.openUntil) {
		return state, loopBudgetDecision{Allowed: false, Remaining: state.openUntil.Sub(now)}
	}
	// The cooldown has expired, so the pair gets a fresh budget. Reoffending immediately is what
	// escalates the next cooldown.
	if !state.openUntil.IsZero() {
		state.openUntil = time.Time{}
		state.windowStart = time.Time{}
		state.reverse = 0
	}
	if state.windowStart.IsZero() || now.Sub(state.windowStart) >= window {
		state.windowStart = now
		state.reverse = 0
	}
	state.reverse += 1
	if state.reverse <= config.Allow {
		return state, loopBudgetDecision{Allowed: true}
	}
	cooldown := config.FirstCooldown
	if state.strikes > 0 || config.FirstCooldown <= 0 {
		cooldown = config.RepeatCooldown
	}
	if cooldown <= 0 {
		cooldown = config.RepeatCooldown
	}
	state.strikes += 1
	state.openUntil = now.Add(cooldown)
	return state, loopBudgetDecision{Allowed: false, Remaining: cooldown}
}
