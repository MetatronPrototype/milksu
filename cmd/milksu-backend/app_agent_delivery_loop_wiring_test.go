package main

import (
	"testing"
	"time"
)

// 每次"交替"都算一次反向（见 record），所以普通一来一回 + 再答一句 ≈ 4–6 次反向。
// 标准档 N=8 就是为容下这个节奏定的。
func reverseN(pair [2]string, count int, at time.Time) {
	for round := 0; round < count; round++ {
		source, target := pair[0], pair[1]
		if round%2 == 1 {
			source, target = pair[1], pair[0]
		}
		agentDeliveryLoops.record(source, target, at.Add(time.Duration(round)*time.Second))
	}
}

// 接线前的真红：60 秒内一来一回是正常协作 —— 旧逻辑当场封 5 分钟。
func TestDeliveryLoopAllowsAnOrdinaryReply(t *testing.T) {
	agentDeliveryLoops.reset()
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	agentDeliveryLoops.record("conv-a", "conv-b", now)
	agentDeliveryLoops.record("conv-b", "conv-a", now.Add(2*time.Second))
	if got := agentDeliveryLoops.remaining("conv-b", "conv-a", now.Add(3*time.Second)); got != 0 {
		t.Fatalf("one ordinary reply must not open a cooldown, got %s", got)
	}
	agentDeliveryLoops.record("conv-a", "conv-b", now.Add(4*time.Second))
	agentDeliveryLoops.record("conv-b", "conv-a", now.Add(6*time.Second))
	if got := agentDeliveryLoops.remaining("conv-a", "conv-b", now.Add(7*time.Second)); got != 0 {
		t.Fatalf("ordinary collaboration must stay under the budget, got %s", got)
	}
}

// 真互刷：几秒内 12 次反向 ⇒ 仍被拦，剩余冷却可读且递减。
func TestDeliveryLoopStillStopsRealSpam(t *testing.T) {
	agentDeliveryLoops.reset()
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	reverseN([2]string{"conv-a", "conv-b"}, 12, now)
	got := agentDeliveryLoops.remaining("conv-a", "conv-b", now.Add(13*time.Second))
	if got <= 0 {
		t.Fatalf("a tight ping-pong must still be broken")
	}
	if got < 50*time.Second {
		t.Fatalf("the refusal must carry a readable remaining cooldown, got %s", got)
	}
	if again := agentDeliveryLoops.remaining("conv-b", "conv-a", now.Add(30*time.Second)); again <= 0 || again >= got {
		t.Fatalf("remaining cooldown must count down inside the cooldown, got %s after %s", again, got)
	}
}

// 递进：首犯 60 秒；用注入的 now 让冷却真正走完 ⇒ 预算重置；马上再犯 ⇒ 5 分钟。
func TestDeliveryLoopEscalatesOnARepeatOffence(t *testing.T) {
	agentDeliveryLoops.reset()
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	reverseN([2]string{"conv-a", "conv-b"}, 12, now)
	first := agentDeliveryLoops.remaining("conv-a", "conv-b", now.Add(13*time.Second))
	if first <= 0 || first > 61*time.Second {
		t.Fatalf("the first offence must serve the short cooldown (60s), got %s", first)
	}
	after := now.Add(13*time.Second + first + 2*time.Second)
	if got := agentDeliveryLoops.remaining("conv-a", "conv-b", after); got != 0 {
		t.Fatalf("the cooldown must be over by %s, got %s", after, got)
	}
	agentDeliveryLoops.record("conv-a", "conv-b", after)
	agentDeliveryLoops.record("conv-b", "conv-a", after.Add(time.Second))
	if got := agentDeliveryLoops.remaining("conv-a", "conv-b", after.Add(2*time.Second)); got != 0 {
		t.Fatalf("after the cooldown the budget must reset, got %s", got)
	}
	reverseN([2]string{"conv-a", "conv-b"}, 12, after.Add(3*time.Second))
	if repeat := agentDeliveryLoops.remaining("conv-a", "conv-b", after.Add(16*time.Second)); repeat <= 61*time.Second {
		t.Fatalf("a repeat offence must escalate to the longer cooldown (5m), got %s", repeat)
	}
}
