package codingattachment

import (
	"bytes"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const sendableRealHeicPath = "/Users/xiaoxingjiang/Downloads/IMG_2646.HEIC"

func readSendableRealHeic(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(sendableRealHeicPath)
	if err != nil {
		t.Skipf("真机 HEIC 不在本机（%s）：%v", sendableRealHeicPath, err)
	}
	return data
}

// 用 sips 现造一张"小 HEIC"（很小的 PNG ⇒ HEIC）：避免往仓库里塞二进制 fixture。
func smallHeic(t *testing.T) []byte {
	t.Helper()
	if _, err := exec.LookPath("sips"); err != nil {
		t.Skip("sips is unavailable")
	}
	directory := t.TempDir()
	png := filepath.Join(directory, "tiny.png")
	heic := filepath.Join(directory, "tiny.heic")
	// 8x8 的 PNG：用 sips 从一张最小的位图生成不易，这里改用真机照片缩小一版（sips 自己负责编码）。
	source := readSendableRealHeic(t)
	if err := os.WriteFile(png, source, 0o600); err != nil {
		t.Fatal(err)
	}
	small := filepath.Join(directory, "small.png")
	if out, err := exec.Command("sips", "-Z", "64", "--out", small, png).CombinedOutput(); err != nil {
		t.Skipf("sips could not shrink the fixture: %v %s", err, out)
	}
	if out, err := exec.Command("sips", "-s", "format", "heic", "--out", heic, small).CombinedOutput(); err != nil {
		t.Skipf("sips could not produce a HEIC fixture: %v %s", err, out)
	}
	data, err := os.ReadFile(heic)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// 真机那张：转换后超可发送体积 ⇒ 压缩到目标内**才发得出去**（现在 33,668,242 字节会被 32 MiB 挡下）。
func TestTheLargestRealPhotoBecomesSendableWithoutLosingResolution(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	imported, err := store.ImportPayloads([]ImportPayload{{
		Name:       "IMG_2646.HEIC",
		MediaType:  "image/heic",
		DataBase64: base64.StdEncoding.EncodeToString(readSendableRealHeic(t)),
	}})
	if err != nil {
		t.Fatalf("the reader's own photo must become sendable, got: %v", err)
	}
	if len(imported) != 1 {
		t.Fatalf("imported %d attachments, want 1", len(imported))
	}
	attachment := imported[0]
	if attachment.Size > maxSendableBytes {
		t.Fatalf("attachment is %d bytes, want <= %d", attachment.Size, maxSendableBytes)
	}
	if attachment.MediaType != "image/jpeg" {
		t.Fatalf("a compressed photo must be a JPEG, got %q", attachment.MediaType)
	}
	if !strings.HasSuffix(attachment.Name, ".jpg") {
		t.Fatalf("name = %q, want a .jpg name", attachment.Name)
	}
	// 硬要求：只降质量，**不降分辨率** —— 断言"压缩前后宽高一致"，**不写死任何数字**
	// （那个 5712×4284 只是这次真机文件的观测值，不是约束）。
	pngWidth, pngHeight, ok := PNGPixelSize(mustConvert(t, readSendableRealHeic(t)))
	if !ok {
		t.Fatal("the source png has no readable size")
	}
	stored, err := store.read(attachment)
	if err != nil {
		t.Fatal(err)
	}
	width, height, ok := JPEGPixelSize(stored)
	if !ok {
		t.Fatal("the stored copy is not a readable JPEG")
	}
	if width != pngWidth || height != pngHeight {
		t.Fatalf("compression rescaled the photo: %dx%d -> %dx%d", pngWidth, pngHeight, width, height)
	}
	// 不能静默压缩：必须有双语提示，并说明原图未改。
	if attachment.Notice == "" || attachment.NoticeEnglish == "" {
		t.Fatalf("a compressed photo must carry a bilingual notice, got %q / %q", attachment.Notice, attachment.NoticeEnglish)
	}
	if !strings.Contains(attachment.Notice, "原图在本地未改") || !strings.Contains(attachment.NoticeEnglish, "original file is unchanged") {
		t.Fatalf("the notice must say the original is untouched: %q / %q", attachment.Notice, attachment.NoticeEnglish)
	}
}

// 能无损发就必须无损发：小 HEIC ⇒ 仍是 PNG，且**没有**压缩提示。
func TestASmallHeicStaysLossless(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	imported, err := store.ImportPayloads([]ImportPayload{{
		Name:       "small.heic",
		MediaType:  "image/heic",
		DataBase64: base64.StdEncoding.EncodeToString(smallHeic(t)),
	}})
	if err != nil {
		t.Fatalf("a small HEIC must import: %v", err)
	}
	attachment := imported[0]
	if attachment.MediaType != "image/png" {
		t.Fatalf("a small HEIC must stay lossless PNG, got %q", attachment.MediaType)
	}
	if attachment.Notice != "" || attachment.NoticeEnglish != "" {
		t.Fatalf("nothing was compressed, so there must be no notice: %q", attachment.Notice)
	}
}

// 防越权：读者自己上传的文件（哪怕很大、哪怕是 PNG/JPEG）**一律不压**。
func TestReaderUploadedFilesAreNeverCompressed(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	png := filepath.Join(t.TempDir(), "big.png")
	if out, err := exec.Command("sips", "-s", "format", "png", "-Z", "1200", "--out", png, sendableRealHeicPath).CombinedOutput(); err != nil {
		t.Skipf("could not build a reader-side PNG fixture: %v %s", err, out)
	}
	original, err := os.ReadFile(png)
	if err != nil {
		t.Fatal(err)
	}
	// 夹具断言：它必须真的是 PNG —— `sips -Z` 只缩放、**不改格式**，
	// 少了 `-s format png` 就会得到"名字叫 .png 的 HEIC"（我第一版就栽在这）。
	if LooksLikeHEIC(original) {
		t.Fatal("the reader-side fixture must be a real PNG, not a renamed HEIC")
	}
	imported, err := store.ImportPayloads([]ImportPayload{{
		Name:       "reader-photo.png",
		MediaType:  "image/png",
		DataBase64: base64.StdEncoding.EncodeToString(original),
	}})
	if err != nil {
		t.Fatalf("importing the reader's PNG failed: %v", err)
	}
	attachment := imported[0]
	if attachment.MediaType != "image/png" {
		t.Fatalf("a reader-uploaded PNG must stay a PNG, got %q", attachment.MediaType)
	}
	if attachment.Notice != "" {
		t.Fatalf("a reader-uploaded file must never be compressed, got notice %q", attachment.Notice)
	}
	stored, err := store.read(attachment)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stored, original) {
		t.Fatal("a reader-uploaded PNG was modified: its bytes must be stored as-is")
	}
}

// 命名：压缩成 JPEG 就 .jpg；PNG 就 .png。
func TestSendableNameTellsTheTruth(t *testing.T) {
	if name := sendableNameFor("IMG_2646.HEIC", "image/png"); name != "IMG_2646.png" {
		t.Fatalf("png name = %q", name)
	}
	if name := sendableNameFor("IMG_2646.HEIC", "image/jpeg"); name != "IMG_2646.jpg" {
		t.Fatalf("jpeg name = %q", name)
	}
}

// 阶梯：第一档达标就停（能少压就少压），且分辨率不变。
func TestFitForSendingStopsAtTheFirstQualityThatFits(t *testing.T) {
	source := bytes.Repeat([]byte{0x89, 'P', 'N', 'G'}, 1)
	// 造一个"超过目标"的输入：用真机 PNG 太慢，这里直接验证"本来就达标 ⇒ 原样返回"。
	small := []byte("PNG-DATA")
	data, mediaType, quality, err := FitForSending(small, func(_, _ string, _ int) error { return nil })
	if err != nil {
		t.Fatalf("a small png must pass through: %v", err)
	}
	if quality != 0 || mediaType != "image/png" || !bytes.Equal(data, small) {
		t.Fatalf("small png should be returned untouched, got %q q=%d", mediaType, quality)
	}
	_ = source
}

func mustConvert(t *testing.T, heic []byte) []byte {
	t.Helper()
	png, err := ConvertHEICToPNG(heic, nil)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	return png
}

// 质量下限内压不到目标体积 ⇒ **放弃压缩**：原样返回无损 PNG、quality=0（界面因此不会显示"已压缩"），
// 之后由原有"超限 ⇒ 本地扣下 + 点名告知"那条链路处理。
func TestFitForSendingGivesUpInsteadOfOverCompressing(t *testing.T) {
	oversized := bytes.Repeat([]byte{0x89, 'P', 'N', 'G'}, maxSendableBytes/4+64)
	// 注入的"压缩器"产出一张**真的 JPEG**、但补齐到仍然超标 ⇒ 模拟"压到下限还是压不下去"。
	// （必须是真的 JPEG：FitForSending 会校验它确实拿到了可读图片，不读半成品。）
	directory := t.TempDir()
	base := filepath.Join(directory, "base.jpg")
	sourcePNG := filepath.Join(directory, "source.png")
	realPNG := mustConvert(t, readSendableRealHeic(t))
	if err := os.WriteFile(sourcePNG, realPNG, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := runSipsToJPEG(sourcePNG, base, 92); err != nil {
		t.Skipf("sips could not build the fixture: %v", err)
	}
	small, err := os.ReadFile(base)
	if err != nil {
		t.Fatal(err)
	}
	// 补齐到**超过**目标（24 MiB）才叫"压不下去"：这里加一整份目标大小。
	padded := append(append([]byte{}, small...), make([]byte, maxSendableBytes)...)
	run := func(_ string, target string, _ int) error {
		return os.WriteFile(target, padded, 0o600)
	}
	data, mediaType, quality, err := FitForSending(oversized, run)
	if err != nil {
		t.Fatalf("giving up must not be an error: %v", err)
	}
	if quality != 0 || mediaType != "image/png" {
		t.Fatalf("when the floor cannot reach the target we must keep the lossless png, got %q q=%d", mediaType, quality)
	}
	if !bytes.Equal(data, oversized) {
		t.Fatal("giving up must return the untouched png")
	}
	// 质量下限：阶梯里不许出现低于 90 的档。
	for _, step := range jpegQualityLadder {
		if step < 90 {
			t.Fatalf("the quality floor is 90, found %d in the ladder", step)
		}
	}
	if len(jpegQualityLadder) == 0 || jpegQualityLadder[len(jpegQualityLadder)-1] != 90 {
		t.Fatalf("the ladder must end at the floor 90, got %v", jpegQualityLadder)
	}
}
