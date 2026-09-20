package main

import "sync"

// The level the loop breaker runs at. Reading it from the stored collaboration setting is the next step;
// until then this reports the standard level. It must never report an empty value, so a missing or
// damaged setting cannot silently disable the breaker.
var (
	agentDeliveryLoopLevelMu    sync.RWMutex
	agentDeliveryLoopLevelValue = "standard"
)

func agentDeliveryLoopLevel() string {
	agentDeliveryLoopLevelMu.RLock()
	defer agentDeliveryLoopLevelMu.RUnlock()
	if agentDeliveryLoopLevelValue == "" {
		return "standard"
	}
	return agentDeliveryLoopLevelValue
}

// setAgentDeliveryLoopLevel lets the settings path (and the tests) pick a level.
func setAgentDeliveryLoopLevel(level string) {
	agentDeliveryLoopLevelMu.Lock()
	defer agentDeliveryLoopLevelMu.Unlock()
	agentDeliveryLoopLevelValue = level
}
