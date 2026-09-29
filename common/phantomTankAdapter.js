/**
 * 幻影坦克的平台适配层：选图、读像素、导出 PNG、保存。
 * 各端差异全部收在这个文件里，页面和 common/phantomTank.js 都不碰平台 API。
 *
 * 两处刻意的设计：
 * 1. 分支调度用运行时平台探测（uniPlatform + 能力探测），而不是只靠 #ifdef。
 *    #ifdef 只用来剥离各端专有的全局对象（document / canvas 节点），
 *    这样即使 #ifdef 在某些 HBuilderX 版本里不生效，调度也不会走错分支。
 * 2. 导出前先 clearRect 并把 a==0 的像素规范成 RGB(0,0,0)，
 *    这是社区对「透明区域被拍成黑底或白底」的已知缓解手段。
 */

import { coverRect } from './phantomTank.js'
import { encodePng } from './pngWriter.js'

const CANVAS_ID = 'phantomCanvas'

// ---------------------------------------------------------------- 平台判定

let cachedPlatform = ''

export function platformName() {
	if (cachedPlatform) return cachedPlatform
	let name = ''
	try {
		const info = uni.getSystemInfoSync()
		if (info && info.uniPlatform) name = info.uniPlatform
	} catch (error) {
		name = ''
	}
	if (!name) {
		// uniPlatform 缺失时按能力探测，顺序不能变：
		// App 的 vue 页面跑在 webview 里，document 是存在的，必须先认出 App。
		if (typeof plus !== 'undefined' && plus) name = 'app'
		else if (typeof wx !== 'undefined' && wx && wx.createSelectorQuery) name = 'mp-weixin'
		else if (typeof document !== 'undefined') name = 'web'
		else name = 'unknown'
	}
	cachedPlatform = name
	return name
}

// ---------------------------------------------------------------- 诊断信息

const diag = {
	platform: '',
	canvasNode: '未测试',
	readBytes: 0,
	alphaSamples: 0,
	alphaNonZero: 0,
	lastError: ''
}

/** 页面把失败原因记进来，诊断面板里就能看到最近一次错误 */
export function noteError(message) {
	diag.lastError = message || ''
}

export function getDiagnostics() {
	diag.platform = platformName()
	let system = ''
	try {
		const info = uni.getSystemInfoSync()
		system = [info.system, info.platform, info.SDKVersion ? '基础库 ' + info.SDKVersion : '']
			.filter(Boolean)
			.join(' / ')
	} catch (error) {
		system = '(取不到系统信息)'
	}
	return {
		platform: diag.platform,
		system: system,
		canvasNode: diag.canvasNode,
		readBytes: diag.readBytes,
		alphaSamples: diag.alphaSamples,
		alphaNonZero: diag.alphaNonZero,
		lastError: diag.lastError
	}
}

function noteReadData(data) {
	diag.readBytes = data.length
	let samples = 0
	let nonZero = 0
	// 抽样 alpha 通道：全是 0 基本就说明这一端没读到像素
	for (let i = 3; i < data.length; i += 4 * 997) {
		samples++
		if (data[i] !== 0) nonZero++
	}
	diag.alphaSamples = samples
	diag.alphaNonZero = nonZero
}

// 统一的 cover 绘制（9 参 drawImage 在 H5 / 小程序 / App 都支持裁剪）
function drawCover(ctx, source, sourceWidth, sourceHeight, targetW, targetH) {
	const rect = coverRect(sourceWidth || targetW, sourceHeight || targetH, targetW, targetH)
	ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, targetW, targetH)
}

// ---------------------------------------------------------------- 选图

function makePickError(error) {
	const message = describeError(error)
	const wrapped = new Error(message)
	wrapped.errMsg = message
	return wrapped
}

function isCancel(error) {
	// 「用户取消选择」不是错误，各端都会走到 fail，必须当成空结果处理
	return /cancel/i.test(describeError(error))
}

// App 上选 compressed 会额外走一次压缩（需要写文件的权限），
// 而我们后面本来就要缩放到长边上限，所以只有小程序用 compressed。
function sizeType() {
	return platformName() === 'mp-weixin' ? 'compressed' : 'original'
}

function pickImagesByApi(pickCount) {
	// 小程序和 App（3.x）都优先用 chooseMedia：它会直接弹相册页，
	// 不经过 chooseImage 那套 nativeUI 动作面板，出错概率更低。H5 没有这个 API。
	if (platformName() !== 'web' && typeof uni.chooseMedia === 'function') {
		return new Promise((resolve, reject) => {
			uni.chooseMedia({
				count: pickCount,
				mediaType: ['image'],
				sourceType: ['album', 'camera'],
				sizeType: [sizeType()],
				success: (res) =>
					resolve((res.tempFiles || []).map((file) => file.tempFilePath || file.tempFile)),
				fail: (err) => reject(makePickError(err))
			})
		})
	}
	return new Promise((resolve, reject) => {
		uni.chooseImage({
			count: pickCount,
			sizeType: [sizeType()],
			sourceType: ['album', 'camera'],
			success: (res) => resolve(res.tempFilePaths || []),
			fail: (err) => reject(makePickError(err))
		})
	})
}

/**
 * 选图，返回本地路径数组。
 * - 用户取消时返回空数组，不抛错。
 * - H5 的 uni.chooseImage 只是 input[type=file] 的一层薄封装（失败时只会抛一个
 *   没有任何细节的 "chooseImage:fail"），所以它失败时直接自己建 input 兜底。
 * - 抛出的错误里带上平台名，方便定位是哪一端的问题。
 */
export async function chooseImages(count) {
	const pickCount = count || 1
	try {
		return await pickImagesByApi(pickCount)
	} catch (error) {
		if (isCancel(error)) return []
		if (platformName() === 'web') {
			// #ifdef H5
			try {
				return await pickImagesByDom(pickCount)
			} catch (domError) {
				throw new Error(describeError(domError) + '（web 兜底也失败）')
			}
			// #endif
		}
		throw new Error(describeError(error) + '（' + platformName() + '）')
	}
}

// #ifdef H5
function pickImagesByDom(pickCount) {
	return new Promise((resolve, reject) => {
		try {
			const input = document.createElement('input')
			input.type = 'file'
			input.accept = 'image/*'
			if (pickCount > 1) input.multiple = true
			input.style.cssText =
				'position:absolute;visibility:hidden;z-index:-999;width:0;height:0;top:0;left:0;'
			const cleanup = () => {
				if (input.parentNode) input.parentNode.removeChild(input)
			}
			input.addEventListener('change', () => {
				const files = input.files
				cleanup()
				if (!files || !files.length) {
					resolve([])
					return
				}
				const paths = []
				for (let i = 0; i < files.length && i < pickCount; i++) {
					paths.push(URL.createObjectURL(files[i]))
				}
				resolve(paths)
			})
			input.addEventListener('cancel', () => {
				cleanup()
				resolve([])
			})
			document.body.appendChild(input)
			input.click()
		} catch (error) {
			reject(error)
		}
	})
}
// #endif

export function getImageSize(path) {
	return new Promise((resolve, reject) => {
		uni.getImageInfo({
			src: path,
			success: (res) => resolve({ width: res.width, height: res.height, path: res.path }),
			fail: (err) => reject(new Error('读取图片信息失败：' + describeError(err)))
		})
	})
}

function describeError(err) {
	if (!err) return '未知错误'
	if (typeof err === 'string') return err
	const message = err.errMsg || err.message
	if (message) {
		// App 端的 fail 还会带 code（比如 11 = resultCode is wrong，12 = 无权限），
		// 一起带出来，否则只有一句光秃秃的 "chooseImage:fail"
		return err.code ? message + '（code ' + err.code + '）' : message
	}
	try {
		return JSON.stringify(err)
	} catch (error) {
		return String(err)
	}
}

// ---------------------------------------------------------------- 读像素

// #ifdef H5
let webCanvas = null

function getWebCanvas(width, height) {
	if (!webCanvas) webCanvas = document.createElement('canvas')
	webCanvas.width = width
	webCanvas.height = height
	return webCanvas
}

function readPixelsWeb(path, target, source) {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => {
			try {
				const canvas = getWebCanvas(target.width, target.height)
				const ctx = canvas.getContext('2d')
				ctx.clearRect(0, 0, target.width, target.height)
				drawCover(
					ctx,
					image,
					(source && source.width) || image.naturalWidth || image.width,
					(source && source.height) || image.naturalHeight || image.height,
					target.width,
					target.height
				)
				const imageData = ctx.getImageData(0, 0, target.width, target.height)
				noteReadData(imageData.data)
				resolve({ width: target.width, height: target.height, data: imageData.data })
			} catch (error) {
				reject(new Error('读取像素失败：' + describeError(error)))
			}
		}
		image.onerror = () => reject(new Error('图片加载失败：' + path))
		image.src = path
	})
}
// #endif

// #ifdef MP-WEIXIN
function readPixelsWeixin(path, target, source, instance) {
	return getCanvasNode(instance).then(
		(canvas) =>
			new Promise((resolve, reject) => {
				canvas.width = target.width
				canvas.height = target.height
				const ctx = canvas.getContext('2d')
				ctx.clearRect(0, 0, target.width, target.height)
				const image = canvas.createImage()
				image.onload = () => {
					try {
						drawCover(
							ctx,
							image,
							(source && source.width) || image.width,
							(source && source.height) || image.height,
							target.width,
							target.height
						)
						const imageData = ctx.getImageData(0, 0, target.width, target.height)
						noteReadData(imageData.data)
						resolve({ width: target.width, height: target.height, data: imageData.data })
					} catch (error) {
						reject(new Error('读取像素失败：' + describeError(error)))
					}
				}
				image.onerror = () => reject(new Error('图片加载失败：' + path))
				image.src = path
			})
	)
}

function getCanvasNode(instance) {
	return new Promise((resolve, reject) => {
		uni.createSelectorQuery()
			.in(instance)
			.select('#' + CANVAS_ID)
			.fields({ node: true, size: true }, (res) => {
				if (res && res.node) {
					diag.canvasNode = '已取到'
					resolve(res.node)
				} else {
					diag.canvasNode = '未取到'
					reject(new Error('没取到 canvas 节点，检查画布是否被 display:none 或 v-if 隐藏了'))
				}
			})
			.exec()
	})
}
// #endif

// #ifdef APP-PLUS
function readPixelsApp(path, target, source) {
	return new Promise((resolve, reject) => {
		const ctx = uni.createCanvasContext(CANVAS_ID)
		// 必须先清空：如果 drawImage 失败（比如路径不对、文件还没写完），
		// 画布上会残留上一次 putImageData 的内容，读出来就是上一次的数据 ——
		// 实测中就靠这个误报过「导出保住了透明通道」。清空后失败会得到全 0，能被识别出来。
		ctx.clearRect(0, 0, target.width, target.height)
		drawCover(
			ctx,
			path,
			(source && source.width) || target.width,
			(source && source.height) || target.height,
			target.width,
			target.height
		)
		// 旧版 canvas 的绘制是异步的，必须等 draw 的回调再读像素
		ctx.draw(false, () => {
			uni.canvasGetImageData({
				canvasId: CANVAS_ID,
				x: 0,
				y: 0,
				width: target.width,
				height: target.height,
				success: (res) => {
					const data = res.data instanceof Uint8ClampedArray ? res.data : new Uint8ClampedArray(res.data)
					noteReadData(data)
					resolve({ width: target.width, height: target.height, data: data })
				},
				fail: (err) => reject(new Error('读取像素失败：' + describeError(err)))
			})
		})
	})
}
// #endif

/**
 * 读取一张图的 RGBA 像素，并等比 cover 到 target 尺寸。
 * target: { width, height }；source: { width, height }（用于裁剪，可缺省）
 */
export function readPixels(path, target, source, instance) {
	const platform = platformName()
	// #ifdef H5
	if (platform === 'web') return readPixelsWeb(path, target, source)
	// #endif
	// #ifdef MP-WEIXIN
	if (platform === 'mp-weixin') return readPixelsWeixin(path, target, source, instance)
	// #endif
	// #ifdef APP-PLUS
	if (platform === 'app') return readPixelsApp(path, target, source)
	// #endif
	return Promise.reject(new Error('当前平台还不支持读取像素：' + platform))
}

// ---------------------------------------------------------------- 导出 PNG

// 导出的统一流程：先用纯 JS 把 PNG 字节算出来，再交给各端落成文件。
// 三个端拿到的是同一份字节，不再依赖各端 canvas 的导出实现。

let fileNameSeed = 0

function nextFileName() {
	fileNameSeed++
	return 'phantom-' + Date.now() + '-' + fileNameSeed + '.png'
}

// #ifdef H5
function exportBytesWeb(bytes) {
	return new Promise((resolve, reject) => {
		try {
			const blob = new Blob([bytes], { type: 'image/png' })
			resolve({ src: URL.createObjectURL(blob) })
		} catch (error) {
			reject(new Error('生成图片失败：' + describeError(error)))
		}
	})
}
// #endif

/**
 * 回收一批图片资源。H5 上 exportPng 返回的是 blob URL，换新一批之前要显式回收，
 * 否则每次生成都会漏掉几个几 MB 的对象；其它平台导出的是临时文件，不需要处理。
 */
export function releaseImage(src) {
	if (!src) return
	// #ifdef H5
	if (src.indexOf('blob:') === 0) URL.revokeObjectURL(src)
	// #endif
	// 自己写出来的文件是持久化的（不像 canvas 导出会落到临时目录），必须删掉：
	// App 会一直占空间，小程序 USER_DATA_PATH 只有 10MB 配额，几次就满了。
	// 只删我们自己命名的文件，不碰用户选的图。
	// #ifdef APP-PLUS
	if (src.indexOf('_doc/phantom-') === 0 && typeof plus !== 'undefined' && plus.io) {
		plus.io.resolveLocalFileSystemURL(
			src,
			(entry) => {
				if (entry && entry.remove) entry.remove(() => {}, () => {})
			},
			() => {}
		)
	}
	// #endif
	// #ifdef MP-WEIXIN
	if (src.indexOf('phantom-') !== -1) {
		const fs = uni.getFileSystemManager()
		if (fs && fs.unlink) fs.unlink({ filePath: src, success: () => {}, fail: () => {} })
	}
	// #endif
}

// #ifdef MP-WEIXIN
function exportBytesWeixin(bytes) {
	return new Promise((resolve, reject) => {
		const fs = uni.getFileSystemManager()
		if (!fs) {
			reject(new Error('getFileSystemManager 不可用，无法写文件'))
			return
		}
		const filePath = wx.env.USER_DATA_PATH + '/' + nextFileName()
		fs.writeFile({
			filePath: filePath,
			data: bytes.buffer,
			success: () => resolve({ src: filePath, tempFilePath: filePath }),
			fail: (error) => reject(new Error('写文件失败：' + describeError(error)))
		})
	})
}
// #endif

// #ifdef APP-PLUS
function exportBytesApp(bytes) {
	return new Promise((resolve, reject) => {
		if (typeof plus === 'undefined' || !plus.io) {
			reject(new Error('plus 运行时不可用，无法写文件'))
			return
		}
		const fileName = nextFileName()
		// plus.io 的 writeAsBinary 要的是「纯 base64 字符串」（不能带 data: 前缀，
		// 否则报「写入数据非base64字符串」）。转码用 uni 自带的，别自己实现。
		// 另外社区反馈一次写大文件容易崩，所以按 384KB 分片顺序写 ——
		// FileWriter 每次写完会自动把写入位置后移，顺序调用即追加。
		// 分片长度取 3 的倍数，保证每片 base64 解码后字节数正好。
		const CHUNK = 384 * 1024
		const parts = []
		for (let offset = 0; offset < bytes.length; offset += CHUNK) {
			const end = Math.min(offset + CHUNK, bytes.length)
			const slice = bytes.subarray(offset, end)
			parts.push(uni.arrayBufferToBase64(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length)))
		}
		plus.io.resolveLocalFileSystemURL(
			'_doc/',
			(entry) => {
				entry.getFile(
					fileName,
					{ create: true },
					(fileEntry) => {
						fileEntry.createWriter(
							(writer) => {
								let index = 0
								writer.onerror = (error) => reject(new Error('写文件失败：' + describeError(error)))
								writer.onwrite = () => {
									index++
									if (index < parts.length) {
										writer.writeAsBinary(parts[index])
									} else {
										resolve({ src: '_doc/' + fileName })
									}
								}
								writer.writeAsBinary(parts[0])
							},
							() => reject(new Error('创建写入器失败'))
						)
					},
					(error) => reject(new Error('创建文件失败：' + describeError(error)))
				)
			},
			(error) => reject(new Error('打开 _doc 目录失败：' + describeError(error)))
		)
	})
}
// #endif

/**
 * 把 RGBA 像素导出成带 alpha 的 PNG，返回可直接给 <image> 用的 src。
 * 字节由 common/pngWriter.js 生成，透明通道完全不经过各端的 canvas 导出实现。
 */
export function exportPng(image) {
	let bytes
	try {
		bytes = encodePng(image)
	} catch (error) {
		return Promise.reject(new Error('生成 PNG 数据失败：' + describeError(error)))
	}
	const platform = platformName()
	// #ifdef H5
	if (platform === 'web') return exportBytesWeb(bytes)
	// #endif
	// #ifdef MP-WEIXIN
	if (platform === 'mp-weixin') return exportBytesWeixin(bytes)
	// #endif
	// #ifdef APP-PLUS
	if (platform === 'app') return exportBytesApp(bytes)
	// #endif
	return Promise.reject(new Error('当前平台还不支持导出 PNG：' + platform))
}

// ---------------------------------------------------------------- 保存

// #ifdef H5
function savePngWeb(src, fileName) {
	return new Promise((resolve, reject) => {
		try {
			const link = document.createElement('a')
			link.href = src
			link.download = fileName || 'phantom-tank.png'
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link)
			resolve()
		} catch (error) {
			reject(new Error('下载失败：' + describeError(error)))
		}
	})
}
// #endif

/** H5 没有相册接口，改为触发下载；小程序 / App 存相册 */
export function savePng(src, fileName) {
	if (platformName() === 'web') {
		// #ifdef H5
		return savePngWeb(src, fileName)
		// #endif
	}
	return new Promise((resolve, reject) => {
		uni.saveImageToPhotosAlbum({
			filePath: src,
			success: () => resolve(),
			fail: (err) => reject(new Error('保存到相册失败（需要相册权限）：' + describeError(err)))
		})
	})
}
