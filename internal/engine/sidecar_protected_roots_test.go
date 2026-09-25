package engine

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

// The sidecar is where the tools run, so the host must hand it the protected roots rather
// than let the agent infer them. This pins the shape of that hand-off.
func TestProtectedRootsVariableNamesRuntimeData(t *testing.T) {
	dataDirectory := filepath.Join(t.TempDir(), "data")
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)

	variable := protectedRootsVariable()
	if variable == "" {
		t.Fatal("protected roots must be resolvable with a data directory override")
	}
	name, value, found := strings.Cut(variable, "=")
	if !found || name != protectedRootsEnvironment {
		t.Fatalf("variable = %q, want %s=<json>", variable, protectedRootsEnvironment)
	}
	var roots []protectedRoot
	if err := json.Unmarshal([]byte(value), &roots); err != nil {
		t.Fatalf("decode protected roots: %v", err)
	}
	found = false
	for _, root := range roots {
		if root.Label == "runtime-data" && root.Path == dataDirectory {
			found = true
		}
		if root.Path == "" || root.Label == "" {
			t.Fatalf("every protected root needs a path and a label: %#v", root)
		}
	}
	if !found {
		t.Fatalf("the runtime data directory must be protected: %#v", roots)
	}
}

// 读者的实际处境：官方侧装机很少（还有自更新），但 beta 测试线一天装五六次，
// 让读者每次手动替换包本体是多余的。
// 所以：beta 渠道下不把 App 本体列为受保护路径；正式渠道与渠道未知时照旧保护；
// 而运行数据/会话记录**任何渠道**都必须保护。
func TestAppBundleProtectionFollowsChannel(t *testing.T) {
	dataDirectory := filepath.Join(t.TempDir(), "data")
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)

	rootsFor := func(channel string) []protectedRoot {
		t.Setenv("MILKSU_CHANNEL", channel)
		_, value, found := strings.Cut(protectedRootsVariable(), "=")
		if !found {
			t.Fatalf("protected roots must resolve for channel %q", channel)
		}
		var roots []protectedRoot
		if err := json.Unmarshal([]byte(value), &roots); err != nil {
			t.Fatalf("decode protected roots: %v", err)
		}
		return roots
	}
	hasLabel := func(roots []protectedRoot, label string) bool {
		for _, root := range roots {
			if root.Label == label {
				return true
			}
		}
		return false
	}

	// 测试二进制不在 .app 里，appBundleRoot() 永远为空，所以要拿假路径直接测纯函数，
	// 否则「beta 下没有 app-bundle」这类断言会永远为真（假守卫）。
	const fakeBundle = "/Users/someone/Applications/MilkSU Beta Test.app"

	t.Setenv("MILKSU_CHANNEL", "beta")
	if !bundleWritableByAgent() {
		t.Error("beta 渠道下 agent 应当能更新测试包本体（读者一天装五六次）")
	}
	if root, ok := appBundleProtectedRoot(fakeBundle); ok {
		t.Errorf("beta 渠道下包本体不应受保护，却得到 %#v", root)
	}
	beta := rootsFor("beta")
	if hasLabel(beta, "app-bundle") {
		t.Error("beta 渠道下不应再把 App 本体列为受保护路径")
	}
	if !hasLabel(beta, "runtime-data") {
		t.Error("beta 渠道下运行数据仍必须受保护")
	}

	t.Setenv("MILKSU_CHANNEL", "stable")
	if bundleWritableByAgent() {
		t.Error("正式渠道下 agent 不得更新 App 本体")
	}
	if root, ok := appBundleProtectedRoot(fakeBundle); !ok || root.Label != "app-bundle" || root.Path != fakeBundle {
		t.Errorf("正式渠道下包本体必须受保护，得到 ok=%v %#v", ok, root)
	}
	if !hasLabel(rootsFor("stable"), "runtime-data") {
		t.Error("正式渠道下运行数据必须受保护")
	}

	t.Setenv("MILKSU_CHANNEL", "")
	if bundleWritableByAgent() {
		t.Error("渠道未知时按最保守处理：App 本体受保护")
	}
	if _, ok := appBundleProtectedRoot(fakeBundle); !ok {
		t.Error("渠道未知时包本体必须受保护")
	}
}
