package main

import (
	"sync"

	"github.com/MilkSU-Official/milksu/internal/config"
)

// The level the loop breaker runs at. Reading it from the stored collaboration setting is the next step;
// until then this reports the standard level. It must never report an empty value, so a missing or
// damaged setting cannot silently disable the breaker.
var (
	agentDeliveryLoopLevelMu    sync.RWMutex
	agentDeliveryLoopLevelValue = "standard"
)

// agentDeliveryLoopLevelFrom reads the level out of the stored collaboration setting. A missing
// setting, an empty value or an unknown value all mean standard: reading it must never loosen the
// breaker, and a damaged settings file must not turn protection off.
func agentDeliveryLoopLevelFrom(value *config.AgentCollaborationConfig) string {
	if value == nil {
		return config.DeliveryLoopLevelStandard
	}
	return config.NormalizeDeliveryLoopLevel(value.LoopLevel)
}

func agentDeliveryLoopLevel() string {
	agentDeliveryLoopLevelMu.RLock()
	defer agentDeliveryLoopLevelMu.RUnlock()
	return config.NormalizeDeliveryLoopLevel(agentDeliveryLoopLevelValue)
}

// setAgentDeliveryLoopLevel lets the settings path (and the tests) pick a level.
func setAgentDeliveryLoopLevel(level string) {
	agentDeliveryLoopLevelMu.Lock()
	defer agentDeliveryLoopLevelMu.Unlock()
	agentDeliveryLoopLevelValue = level
}
