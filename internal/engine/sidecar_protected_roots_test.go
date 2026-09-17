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
