package codingattachment

import (
	"encoding/base64"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

// 真机那张 iPhone 照片：5712×4284（`sips -g pixelWidth` 实测）。读者就是用这张被服务端拒过。
const realHeicPath = "/Users/xiaoxingjiang/Downloads/IMG_2646.HEIC"

func readRealHeic(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(realHeicPath)
	if err != nil {
		t.Skipf("真机 HEIC 不在本机（%s）：%v", realHeicPath, err)
	}
	return data
}

// HEIC 必须能被认出来 —— 不能只信扩展名（用户可能把 HEIC 改名成 .jpg）。
func TestLooksLikeHEIC(t *testing.T) {
	if !LooksLikeHEIC(readRealHeic(t)) {
		t.Fatal("the real iPhone photo must be recognised as HEIC")
	}
	if LooksLikeHEIC([]byte("just some text")) {
		t.Fatal("plain text must not look like HEIC")
	}
	if !IsHEIFMediaType("image/heic") || !IsHEIFMediaType("Image/HEIF") {
		t.Fatal("declared HEIC/HEIF media types must be recognised")
	}
	if IsHEIFMediaType("image/png") {
		t.Fatal("png is not HEIC")
	}
}

// 红线：只换容器 ⇒ 像素尺寸一模一样（OCR 要原分辨率）。
func TestConvertHEICToPNGKeepsTheRealDimensions(t *testing.T) {
	converted, err := ConvertHEICToPNG(readRealHeic(t), nil)
	if err != nil {
		t.Fatalf("converting the real photo failed: %v", err)
	}
	width, height, ok := PNGPixelSize(converted)
	if !ok {
		t.Fatal("the conversion did not produce a readable PNG")
	}
	// 基准取**源文件自己**的尺寸（由 sips 报），不写死任何数字。
	if sourceWidth, sourceHeight, ok := sipsSize(t, realHeicPath); ok {
		if width != sourceWidth || height != sourceHeight {
			t.Fatalf("conversion rescaled the photo: %dx%d -> %dx%d", sourceWidth, sourceHeight, width, height)
		}
	}
	if name := PNGNameFor("IMG_2646.HEIC"); name != "IMG_2646.png" {
		t.Fatalf("stored name = %q, want IMG_2646.png", name)
	}
}

// 读者的原图必须原封不动：我们只是复制进库并转换。
func TestConversionLeavesTheOriginalFileUntouched(t *testing.T) {
	before, err := os.Stat(realHeicPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ConvertHEICToPNG(readRealHeic(t), nil); err != nil {
		t.Fatalf("converting the real photo failed: %v", err)
	}
	after, err := os.Stat(realHeicPath)
	if err != nil {
		t.Fatalf("the reader's original file disappeared: %v", err)
	}
	if after.Size() != before.Size() {
		t.Fatalf("the reader's original file changed size: %d -> %d", before.Size(), after.Size())
	}
}

// 转不了要说清楚是哪张、为什么；且不许产生附件。
func TestUnconvertibleHEICFailsLoudlyWithoutProducingAnAttachment(t *testing.T) {
	broken := append([]byte("ftypheic"), make([]byte, 64)...)
	if _, err := ConvertHEICToPNG(broken, nil); err == nil {
		t.Fatal("a damaged HEIC must not convert silently")
	}
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	_, importErr := store.ImportPayloads([]ImportPayload{{
		Name:       "broken.heic",
		MediaType:  "image/heic",
		DataBase64: base64.StdEncoding.EncodeToString(broken),
	}})
	if importErr == nil {
		t.Fatal("importing a damaged HEIC must fail")
	}
	// 报错必须点名是哪张附件（读者才知道该换哪张图）。
	if !strings.Contains(importErr.Error(), "broken.heic") {
		t.Fatalf("the error must name the attachment, got %q", importErr.Error())
	}
	// 库里不许留下半个附件。
	entries, _ := os.ReadDir(store.root)
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".") {
			t.Fatalf("a failed HEIC import left something behind: %s", entry.Name())
		}
	}
}

// sipsSize 问系统这张图的真实宽高（测试基准用它，而不是写死数字）。
func sipsSize(t *testing.T, path string) (int, int, bool) {
	t.Helper()
	out, err := exec.Command("sips", "-g", "pixelWidth", "-g", "pixelHeight", path).Output()
	if err != nil {
		return 0, 0, false
	}
	width, height := 0, 0
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.SplitN(line, ":", 2)
		if len(fields) != 2 {
			continue
		}
		value, convErr := strconv.Atoi(strings.TrimSpace(fields[1]))
		if convErr != nil {
			continue
		}
		switch strings.TrimSpace(fields[0]) {
		case "pixelWidth":
			width = value
		case "pixelHeight":
			height = value
		}
	}
	return width, height, width > 0 && height > 0
}
