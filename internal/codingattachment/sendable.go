package codingattachment

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// 受控例外（用户明确点头的一次，适用范围**极窄**）：
//
//	只有"我们**自己**从 HEIC/HEIF 转出来的 PNG"、且**超过可发送体积**时，才允许有损压缩；
//	读者自己上传的其它任何文件**一律不压**。原图不删，分辨率**永不**降 ——
//	用户当初禁止压缩/降采样是为了保住 OCR 分辨率，所以"宽高不变"是硬要求。
//
// 目标体积留余量：上限是 32 MiB（MaxFileBytes），这里压到 ≤ 24 MiB 就停，给 base64/传输留出空间。
const maxSendableBytes = 24 << 20

// 质量阶梯：从高到低逐档试，**第一档达标就停**（能少压就少压）。没有任何缩放参数。
var jpegQualityLadder = []int{92, 85, 78, 70, 60, 50}

// JPEGPixelSize 读 JPEG 的 SOF 段（只读文件头，不解码整图）。
func JPEGPixelSize(data []byte) (int, int, bool) {
	if len(data) < 4 || data[0] != 0xff || data[1] != 0xd8 {
		return 0, 0, false
	}
	offset := 2
	for offset+3 < len(data) {
		if data[offset] != 0xff {
			offset++
			continue
		}
		marker := data[offset+1]
		offset += 2
		switch {
		case marker == 0xd8 || marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7):
			continue
		case marker == 0xd9 || marker == 0xda:
			return 0, 0, false
		}
		if offset+1 >= len(data) {
			return 0, 0, false
		}
		length := int(binary.BigEndian.Uint16(data[offset : offset+2]))
		if length < 2 {
			return 0, 0, false
		}
		// SOF0..SOF15，排除 DHT(0xc4)/JPG(0xc8)/DAC(0xcc)
		if marker >= 0xc0 && marker <= 0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc {
			if offset+7 >= len(data) {
				return 0, 0, false
			}
			height := int(binary.BigEndian.Uint16(data[offset+3 : offset+5]))
			width := int(binary.BigEndian.Uint16(data[offset+5 : offset+7]))
			if width <= 0 || height <= 0 {
				return 0, 0, false
			}
			return width, height, true
		}
		offset += length
	}
	return 0, 0, false
}

// FitForSending 决定"这张**我们转出来的** PNG 能不能直接发"：
//   - 本来就在可发送体积内 ⇒ **原样返回 PNG**（能无损就无损，绝不多此一举）；
//   - 超了 ⇒ 按质量阶梯压成 JPEG，**只降质量、不降分辨率**，第一档达标就停；
//   - 阶梯走完仍不达标 ⇒ 报错（诚实失败，交给调用方点名告知读者）。
//
// run 可注入（测试里避免真跑子进程）；为 nil 时用本机 sips。
func FitForSending(png []byte, run func(sourcePath, targetPath string, quality int) error) ([]byte, string, int, error) {
	if len(png) <= maxSendableBytes {
		return png, "image/png", 0, nil
	}
	directory, err := os.MkdirTemp("", "milksu-sendable-")
	if err != nil {
		return nil, "", 0, fmt.Errorf("create temporary directory: %w", err)
	}
	defer os.RemoveAll(directory)

	source := filepath.Join(directory, "source.png")
	if err := os.WriteFile(source, png, 0o600); err != nil {
		return nil, "", 0, fmt.Errorf("write temporary image: %w", err)
	}
	if run == nil {
		run = runSipsToJPEG
	}
	var smallestBytes []byte
	var smallestSize int
	for _, quality := range jpegQualityLadder {
		target := filepath.Join(directory, fmt.Sprintf("q%d.jpg", quality))
		if err := run(source, target, quality); err != nil {
			return nil, "", 0, err
		}
		candidate, err := os.ReadFile(target)
		if err != nil {
			return nil, "", 0, fmt.Errorf("read compressed image: %w", err)
		}
		if width, height, ok := JPEGPixelSize(candidate); !ok {
			return nil, "", 0, errors.New("sips did not produce a readable JPEG")
		} else if width == 0 || height == 0 {
			return nil, "", 0, errors.New("sips produced a JPEG without dimensions")
		}
		if smallestBytes == nil || len(candidate) < len(smallestBytes) {
			smallestBytes, smallestSize = candidate, len(candidate)
		}
		if len(candidate) <= maxSendableBytes {
			return candidate, "image/jpeg", quality, nil
		}
	}
	return nil, "", 0, fmt.Errorf("即使压到最低质量仍然超过可发送体积（%d 字节）", smallestSize)
}

// runSipsToJPEG 只降质量：`-s formatOptions` 是质量档，**没有**任何 -Z/-s dpi 之类的缩放参数。
func runSipsToJPEG(sourcePath, targetPath string, quality int) error {
	command := exec.Command(
		"sips",
		"-s", "format", "jpeg",
		"-s", "formatOptions", fmt.Sprintf("%d", quality),
		"--out", targetPath,
		sourcePath,
	)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("sips failed: %s", message)
	}
	return nil
}

// sendableNameFor 让名字说实话：PNG 就 .png，压成 JPEG 就 .jpg。
func sendableNameFor(name, mediaType string) string {
	extension := filepath.Ext(name)
	base := strings.TrimSuffix(name, extension)
	if mediaType == "image/jpeg" {
		return base + ".jpg"
	}
	return base + ".png"
}
