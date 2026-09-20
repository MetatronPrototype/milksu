package main

import (
	"testing"
	"time"
)

// 正常协作：一来一回 + 一次澄清，到不了预算 ⇒ 不该被拦。
// 现状（一次反向就封 5 分钟）会在这里拦人 —— 这正是用户说的"熔断在卡进度"。
func TestLoopBudgetAllowsOrdinaryCollaboration(t *testing.T) {
	config := loopBudgetConfigFor("standard")
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	var state loopBudgetState
	for round := 0; round < config.Allow; round++ {
		var decision loopBudgetDecision
		state, decision = decideLoopBudget(state, config, now)
		if !decision.Allowed {
			t.Fatalf("reverse delivery %d of %d must be allowed, got blocked for %s", round+1, config.Allow, decision.Remaining)
		}
		if decision.Remaining != 0 {
			t.Fatalf("an allowed delivery must not report a cooldown, got %s", decision.Remaining)
		}
		now = now.Add(5 * time.Second)
	}
}

// 真互刷：窗口内远超预算 ⇒ 拦住，并且信息里要有剩余冷却。
func TestLoopBudgetStopsRealSpam(t *testing.T) {
	config := loopBudgetConfigFor("standard")
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	var state loopBudgetState
	var decision loopBudgetDecision
	// 标准档 N=8：要刷够 12 次才越界（5 次在预算内，不该拦）
	for round := 0; round < 12; round++ {
		state, decision = decideLoopBudget(state, config, now)
		now = now.Add(time.Second)
	}
	if decision.Allowed {
		t.Fatalf("the fifth reverse delivery inside one window must be blocked")
	}
	if decision.Remaining < 55*time.Second {
		t.Fatalf("the refusal must carry the remaining cooldown, got %s", decision.Remaining)
	}
	// 冷却期间再试：仍然拦住，且剩余时间在减少（不是每次重置回满）
	state, again := decideLoopBudget(state, config, now)
	if again.Allowed {
		t.Fatalf("a delivery inside the cooldown must stay blocked")
	}
	if again.Remaining >= decision.Remaining {
		t.Fatalf("remaining cooldown must count down, got %s then %s", decision.Remaining, again.Remaining)
	}
}

// 递进：首犯 60 秒（不是 5 分钟）；冷却过去后预算重置；马上再犯 ⇒ 升级 5 分钟。
func TestLoopBudgetEscalatesOnlyOnARepeat(t *testing.T) {
	config := loopBudgetConfigFor("standard")
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	var state loopBudgetState
	var decision loopBudgetDecision
	for round := 0; round <= config.Allow; round++ {
		state, decision = decideLoopBudget(state, config, now)
	}
	if decision.Remaining != config.FirstCooldown {
		t.Fatalf("first offence must serve the short cooldown %s, got %s", config.FirstCooldown, decision.Remaining)
	}
	// 冷却过去 ⇒ 预算重置：又能正常走满一轮
	now = now.Add(config.FirstCooldown + time.Second)
	for round := 0; round < config.Allow; round++ {
		var allowed loopBudgetDecision
		state, allowed = decideLoopBudget(state, config, now)
		if !allowed.Allowed {
			t.Fatalf("after the cooldown the budget must reset, but delivery %d was blocked", round+1)
		}
		now = now.Add(time.Second)
	}
	// 马上再犯 ⇒ 升级到加重冷却
	state, repeat := decideLoopBudget(state, config, now)
	if repeat.Allowed {
		t.Fatalf("overshooting again must be blocked")
	}
	if repeat.Remaining != config.RepeatCooldown {
		t.Fatalf("a repeat offence must serve %s, got %s", config.RepeatCooldown, repeat.Remaining)
	}
}

// 窗口滚动：窗口以外不再累计（慢慢聊不该攒成一次熔断）。
func TestLoopBudgetWindowRolls(t *testing.T) {
	config := loopBudgetConfigFor("standard")
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	var state loopBudgetState
	for round := 0; round < config.Allow; round++ {
		state, _ = decideLoopBudget(state, config, now)
		now = now.Add(20 * time.Second)
	}
	// 已经过了 60 秒 ⇒ 计数重来，不该因为"累计"就拦
	if state.reverse > config.Allow {
		t.Fatalf("window must roll over, reverse count is %d", state.reverse)
	}
	if _, decision := decideLoopBudget(state, config, now); !decision.Allowed {
		t.Fatalf("a delivery after the window rolled over must be allowed")
	}
}

// 三档：只有 N 与首犯冷却不同；没有"关闭"这一档。
func TestLoopBudgetLevels(t *testing.T) {
	strict, standard, loose := loopBudgetConfigFor("strict"), loopBudgetConfigFor("standard"), loopBudgetConfigFor("loose")
	if strict.Allow != 3 || standard.Allow != 8 || loose.Allow != 20 {
		t.Fatalf("budgets must be 3/8/20, got %d/%d/%d", strict.Allow, standard.Allow, loose.Allow)
	}
	if strict.FirstCooldown != 60*time.Second || standard.FirstCooldown != 60*time.Second || loose.FirstCooldown != 30*time.Second {
		t.Fatalf("first cooldowns must be 60/60/30s")
	}
	if _, ok := loopBudgetLevels["off"]; ok {
		t.Fatalf("there must be no way to turn the breaker off")
	}
	// 未知取值退回标准档，不能悄悄关掉保护
	if loopBudgetConfigFor("nonsense") != standard {
		t.Fatalf("an unknown level must fall back to standard")
	}
	// 严格档：允许 3 次，第 4 次才拦
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	var strictState loopBudgetState
	var strictLast loopBudgetDecision
	for round := 0; round < strict.Allow; round++ {
		var allowed loopBudgetDecision
		strictState, allowed = decideLoopBudget(strictState, strict, now.Add(time.Duration(round)*time.Second))
		if !allowed.Allowed {
			t.Fatalf("strict must allow its budget of %d, blocked at %d", strict.Allow, round+1)
		}
	}
	strictState, strictLast = decideLoopBudget(strictState, strict, now.Add(time.Duration(strict.Allow)*time.Second))
	if strictLast.Allowed {
		t.Fatalf("strict must block past its budget of %d", strict.Allow)
	}
	if strictLast.Remaining != strict.FirstCooldown {
		t.Fatalf("strict first offence must serve %s, got %s", strict.FirstCooldown, strictLast.Remaining)
	}
	// 宽松档：允许 20 次，第 21 次才拦，首犯 30 秒
	var looseState loopBudgetState
	var last loopBudgetDecision
	for round := 0; round < loose.Allow+1; round++ {
		looseState, last = decideLoopBudget(looseState, loose, now.Add(time.Duration(round)*time.Second))
	}
	if last.Allowed {
		t.Fatalf("loose must block past its budget of %d", loose.Allow)
	}
	if last.Remaining != loose.FirstCooldown {
		t.Fatalf("loose first offence must serve %s, got %s", loose.FirstCooldown, last.Remaining)
	}
	if last.Remaining != loose.FirstCooldown {
		t.Fatalf("loose first offence must serve %s, got %s", loose.FirstCooldown, last.Remaining)
	}
}
