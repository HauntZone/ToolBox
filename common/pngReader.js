/**
 * 纯 JS 的 PNG 解码器，没有任何平台依赖。和 pngWriter.js 是一对。
 *
 * 为什么需要它：App 端读像素走的是「把图画进 canvas 再 canvasGetImageData」，
 * 这条路在安卓上读出来的像素和文件本身对不上（同一张图网页端正常、安卓不正常，
 * 而且从文件字节里读出来的显形参数和 canvas 读出来的像素互相矛盾 —— 文件字节是原样的，
 * 所以是 canvas 读错了）。从文件字节直接解，绕开 canvas，各端拿到的是同一份精确像素。
 *
 * 只支持非隔行、位深 8 的常见情况（灰/真彩/调色板/带 alpha）。碰到不支持的就返回 null，
 * 调用方自己退回 canvas 那条路 —— 这个函数永远不抛错。
 */

import { inflate } from './pako.js'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
// 每个颜色类型每像素几个字节（位深 8 时）
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function readUint32(bytes, offset) {
	return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function paeth(a, b, c) {
	const p = a + b - c
	const pa = Math.abs(p - a)
	const pb = Math.abs(p - b)
	const pc = Math.abs(p - c)
	if (pa <= pb && pa <= pc) return a
	if (pb <= pc) return b
	return c
}

/** 这个字节流是不是 PNG（只看签名就行） */
export function isPng(bytes) {
	if (!bytes || bytes.length < 8) return false
	for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return false
	return true
}

/**
 * PNG 字节 -> { width, height, data }（data 是 RGBA 的 Uint8ClampedArray）。
 * 解析不了就返回 null，不抛错。
 */
export function decodePng(bytes) {
	if (!isPng(bytes)) return null

	let width = 0
	let height = 0
	let bitDepth = 0
	let colorType = -1
	let interlace = 0
	let palette = null
	let paletteAlpha = null
	const idatParts = []

	let pos = 8
	while (pos + 8 <= bytes.length) {
		const size = readUint32(bytes, pos)
		// 长度字段不合法就直接放弃，避免越界读
		if (size > bytes.length - pos - 12) return null
		const start = pos + 8
		const type = String.fromCharCode(bytes[start - 4], bytes[start - 3], bytes[start - 2], bytes[start - 1])

		if (type === 'IHDR') {
			width = readUint32(bytes, start)
			height = readUint32(bytes, start + 4)
			bitDepth = bytes[start + 8]
			colorType = bytes[start + 9]
			interlace = bytes[start + 12]
		} else if (type === 'PLTE') {
			palette = bytes.subarray(start, start + size)
		} else if (type === 'tRNS') {
			paletteAlpha = bytes.subarray(start, start + size)
		} else if (type === 'IDAT') {
			idatParts.push(bytes.subarray(start, start + size))
		} else if (type === 'IEND') {
			break
		}
		pos += size + 12
	}

	const channels = CHANNELS[colorType]
	// 隔行、非 8 位深都不支持；交给调用方退回 canvas
	if (!channels || bitDepth !== 8 || interlace !== 0 || !width || !height) return null
	if (!idatParts.length) return null

	// 拼接 IDAT 再解压
	let total = 0
	for (let i = 0; i < idatParts.length; i++) total += idatParts[i].length
	const compressed = new Uint8Array(total)
	let offset = 0
	for (let i = 0; i < idatParts.length; i++) {
		compressed.set(idatParts[i], offset)
		offset += idatParts[i].length
	}

	let raw
	try {
		raw = inflate(compressed)
	} catch (error) {
		return null
	}

	const rowBytes = width * channels
	const stride = rowBytes + 1
	if (!raw || raw.length < stride * height) return null

	// 逐行反过滤（PNG 的 5 种行过滤器）
	const pixels = new Uint8Array(rowBytes * height)
	for (let y = 0; y < height; y++) {
		const filter = raw[y * stride]
		const src = y * stride + 1
		const dst = y * rowBytes
		const up = dst - rowBytes
		for (let i = 0; i < rowBytes; i++) {
			const x = raw[src + i]
			const a = i >= channels ? pixels[dst + i - channels] : 0
			const b = y > 0 ? pixels[up + i] : 0
			const c = y > 0 && i >= channels ? pixels[up + i - channels] : 0
			let value
			if (filter === 0) value = x
			else if (filter === 1) value = x + a
			else if (filter === 2) value = x + b
			else if (filter === 3) value = x + ((a + b) >> 1)
			else if (filter === 4) value = x + paeth(a, b, c)
			else return null
			pixels[dst + i] = value & 0xff
		}
	}

	// 按颜色类型摊成 RGBA
	const out = new Uint8ClampedArray(width * height * 4)
	for (let p = 0, s = 0, d = 0; p < width * height; p++, s += channels, d += 4) {
		if (colorType === 0) {
			out[d] = pixels[s]
			out[d + 1] = pixels[s]
			out[d + 2] = pixels[s]
			out[d + 3] = 255
		} else if (colorType === 2) {
			out[d] = pixels[s]
			out[d + 1] = pixels[s + 1]
			out[d + 2] = pixels[s + 2]
			out[d + 3] = 255
		} else if (colorType === 3) {
			const index = pixels[s]
			const pi = index * 3
			if (!palette || pi + 2 >= palette.length) return null
			out[d] = palette[pi]
			out[d + 1] = palette[pi + 1]
			out[d + 2] = palette[pi + 2]
			out[d + 3] = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255
		} else if (colorType === 4) {
			out[d] = pixels[s]
			out[d + 1] = pixels[s]
			out[d + 2] = pixels[s]
			out[d + 3] = pixels[s + 1]
		} else {
			out[d] = pixels[s]
			out[d + 1] = pixels[s + 1]
			out[d + 2] = pixels[s + 2]
			out[d + 3] = pixels[s + 3]
		}
	}

	return { width, height, data: out }
}
