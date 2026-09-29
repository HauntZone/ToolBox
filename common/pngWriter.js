/**
 * 纯 JS 的 PNG 编码器，没有任何平台依赖。
 *
 * 为什么不用 canvas 导出：App 端把像素 putImageData 进画布再 canvasToTempFilePath
 * 出来的 PNG 会丢掉 alpha 通道（实测文件在白底/黑底上看不出任何区别），而幻影坦克的
 * 全部价值就在 alpha 上。自己写字节就能完全控制输出，三个端行为也一致。
 *
 * PNG 结构：签名 + IHDR + IDAT + IEND，每个 chunk 自带 CRC32。
 * IDAT 的内容是一个 zlib 流，交给 pako 压（pako.deflate 默认产出的正好是带
 * adler32 尾巴的 zlib 流，所以不用自己算 adler32）。
 * 不做行过滤（每行 filter 字节写 0），换来的是逻辑简单、没有可错的地方。
 */

import { deflate } from './pako.js'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const COLOR_TYPE_GRAY = 0 // 每像素 1 字节
const COLOR_TYPE_GRAY_ALPHA = 4 // 每像素 2 字节
const COLOR_TYPE_RGBA = 6 // 每像素 4 字节

let crcTable = null

function getCrcTable() {
	if (crcTable) return crcTable
	crcTable = new Int32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		}
		crcTable[n] = c
	}
	return crcTable
}

function crc32(bytes) {
	const table = getCrcTable()
	let c = 0xffffffff
	for (let i = 0; i < bytes.length; i++) {
		c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
	}
	return (c ^ 0xffffffff) >>> 0
}

function writeUint32(target, offset, value) {
	target[offset] = (value >>> 24) & 0xff
	target[offset + 1] = (value >>> 16) & 0xff
	target[offset + 2] = (value >>> 8) & 0xff
	target[offset + 3] = value & 0xff
}

// 长度(4) + 类型(4) + 数据 + CRC32(类型+数据)
function makeChunk(type, data) {
	const chunk = new Uint8Array(12 + data.length)
	writeUint32(chunk, 0, data.length)
	for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i)
	chunk.set(data, 8)
	writeUint32(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
	return chunk
}

/**
 * { width, height, data } → PNG 字节（Uint8Array）。data 是 RGBA 的 Uint8ClampedArray。
 * 会根据内容自动选灰度 / 灰度+alpha / 真彩+alpha 三种颜色类型。
 */
export function encodePng(image) {
	if (!image || !image.data) throw new Error('缺少像素数据')
	const width = image.width
	const height = image.height
	if (!width || !height) throw new Error('图片尺寸不合法')
	const data = image.data
	const rowBytes = width * 4
	if (data.length < rowBytes * height) {
		throw new Error('像素数据长度与尺寸不符：' + data.length + ' < ' + rowBytes * height)
	}

	// 挑一个最省的颜色类型。默认走灰度模式时 R=G=B，用 RGBA 存等于浪费 4 倍空间：
	// 灰度 1 字节/像素、灰度+alpha 2 字节，压缩更快、文件更小（小文件也更不容易
	// 被聊天软件重新压缩，那会抹掉 alpha）。全量扫一遍再决定，不做抽样，避免误判。
	let gray = true
	let alphaUsed = false
	for (let p = 0; p < width * height; p++) {
		const i = p * 4
		if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) {
			gray = false
			break
		}
		if (data[i + 3] !== 255) alphaUsed = true
	}

	let colorType
	let bytesPerPixel
	if (gray && alphaUsed) {
		colorType = COLOR_TYPE_GRAY_ALPHA
		bytesPerPixel = 2
	} else if (gray) {
		colorType = COLOR_TYPE_GRAY
		bytesPerPixel = 1
	} else {
		colorType = COLOR_TYPE_RGBA
		bytesPerPixel = 4
	}

	// PNG 要求每行前面加一个 filter 字节，0 表示不做行过滤
	const rawRowBytes = width * bytesPerPixel
	const raw = new Uint8Array(height * (rawRowBytes + 1))
	for (let y = 0; y < height; y++) {
		const target = y * (rawRowBytes + 1)
		raw[target] = 0
		let cursor = target + 1
		const rowStart = y * rowBytes
		if (bytesPerPixel === 4) {
			raw.set(data.subarray(rowStart, rowStart + rowBytes), cursor)
		} else if (bytesPerPixel === 1) {
			for (let x = 0; x < width; x++) raw[cursor++] = data[rowStart + x * 4]
		} else {
			for (let x = 0; x < width; x++) {
				raw[cursor++] = data[rowStart + x * 4]
				raw[cursor++] = data[rowStart + x * 4 + 3]
			}
		}
	}

	const ihdr = new Uint8Array(13)
	writeUint32(ihdr, 0, width)
	writeUint32(ihdr, 4, height)
	ihdr[8] = 8 // 位深
	ihdr[9] = colorType
	ihdr[10] = 0 // 压缩方法
	ihdr[11] = 0 // 过滤方法
	ihdr[12] = 0 // 非隔行

	const idat = deflate(raw)

	const parts = [
		new Uint8Array(SIGNATURE),
		makeChunk('IHDR', ihdr),
		makeChunk('IDAT', idat),
		makeChunk('IEND', new Uint8Array(0))
	]
	let total = 0
	for (let i = 0; i < parts.length; i++) total += parts[i].length
	const out = new Uint8Array(total)
	let offset = 0
	for (let i = 0; i < parts.length; i++) {
		out.set(parts[i], offset)
		offset += parts[i].length
	}
	return out
}
