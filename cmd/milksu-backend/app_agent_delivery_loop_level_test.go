package main

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

// 设置里的档位必须真的传到熔断上；读不到/空/非法一律退回标准档（不报错、不放宽）。
func TestAgentDeliveryLoopLevelComesFromTheSetting(t *testing.T) {
	cases := []struct {
		name  string
		value *config.AgentCollaborationConfig
		want  string
	}{
		{"no collaboration block at all", nil, config.DeliveryLoopLevelStandard},
		{"empty stored value", &config.AgentCollaborationConfig{}, config.DeliveryLoopLevelStandard},
		{"strict", &config.AgentCollaborationConfig{LoopLevel: "strict"}, config.DeliveryLoopLevelStrict},
		{"loose", &config.AgentCollaborationConfig{LoopLevel: "loose"}, config.DeliveryLoopLevelLoose},
		{"standard", &config.AgentCollaborationConfig{LoopLevel: "standard"}, config.DeliveryLoopLevelStandard},
		{"unknown value must not loosen the breaker", &config.AgentCollaborationConfig{LoopLevel: "off"}, config.DeliveryLoopLevelStandard},
		{"damaged value must not loosen the breaker", &config.AgentCollaborationConfig{LoopLevel: "LOOSE!!"}, config.DeliveryLoopLevelStandard},
		{"case and spacing are tolerated", &config.AgentCollaborationConfig{LoopLevel: "  Strict "}, config.DeliveryLoopLevelStrict},
	}
	for _, item := range cases {
		if got := agentDeliveryLoopLevelFrom(item.value); got != item.want {
			t.Fatalf("%s: agentDeliveryLoopLevelFrom = %q, want %q", item.name, got, item.want)
		}
	}
}

// 档位必须真的改变熔断用的预算：3 / 8 / 20（数值本身不在本轮改动范围内）。
func TestAgentDeliveryLoopLevelPicksTheBudgetForThatLevel(t *testing.T) {
	cases := []struct {
		level string
		allow int
	}{
		{config.DeliveryLoopLevelStrict, 3},
		{config.DeliveryLoopLevelStandard, 8},
		{config.DeliveryLoopLevelLoose, 20},
	}
	for _, item := range cases {
		got := loopBudgetConfigFor(agentDeliveryLoopLevelFrom(&config.AgentCollaborationConfig{LoopLevel: item.level}))
		if got.Allow != item.allow {
			t.Fatalf("%s: budget allow = %d, want %d", item.level, got.Allow, item.allow)
		}
	}
	// 拿不到设置 ⇒ 走标准档的预算，而不是某个零值配置（零值会把所有投递都拦下）。
	fallback := loopBudgetConfigFor(agentDeliveryLoopLevelFrom(nil))
	if fallback.Allow != 8 {
		t.Fatalf("a missing setting must fall back to the standard budget (8), got %d", fallback.Allow)
	}
}
