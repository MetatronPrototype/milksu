package engine

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/config"
)

// 未送达回执的 spool 必须由**启动处**指明目录，不能靠人手设环境变量：
// 没设的话侧车那边整个功能是禁用的 —— 代码在、但不生效（等于白做）。
func TestSidecarEnvironmentNamesTheDeliverySpool(t *testing.T) {
	dataDirectory := filepath.Join(t.TempDir(), "data")
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)

	environment, err := sidecarEnvironment(config.AppSettings{})
	if err != nil {
		t.Fatalf("sidecarEnvironment: %v", err)
	}

	want := "MILKSU_DELIVERY_SPOOL_DIR=" + filepath.Join(dataDirectory, "agent-home", "delivery-spool")
	found := false
	for _, entry := range environment {
		if entry == want {
			found = true
			break
		}
	}
	if !found {
		// 打印实际的同名项，失败时能一眼看出指向了哪里（或根本没有这一项）。
		actual := "<missing>"
		for _, entry := range environment {
			if strings.HasPrefix(entry, "MILKSU_DELIVERY_SPOOL_DIR=") {
				actual = entry
				break
			}
		}
		t.Fatalf("sidecar environment must name the delivery spool as %q, got %q", want, actual)
	}
}
