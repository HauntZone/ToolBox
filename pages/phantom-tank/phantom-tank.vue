<template>
	<view class="page">
		<view class="tabs">
			<view
				v-for="tab in tabs"
				:key="tab.value"
				class="tab"
				:class="{ 'tab-active': mode === tab.value }"
				hover-class="tab-hover"
				:hover-stay-time="60"
				@click="switchMode(tab.value)"
			>
				<text class="tab-text">{{ tab.label }}</text>
			</view>
		</view>

		<!-- ==================== 编码 ==================== -->
		<block v-if="mode === 'encode'">
			<view class="card">
				<text class="label">选择两张图片</text>
				<text class="hint">左图决定输出尺寸和比例，右图按它的比例居中裁剪，所以两张尺寸不同也能用</text>
				<view class="slots">
					<view class="slot" hover-class="slot-hover" @click="pickImage('white')">
						<image v-if="whiteImage.src" class="slot-image" :src="whiteImage.src" mode="aspectFit"></image>
						<text v-else class="slot-plus">+</text>
						<text class="slot-label">白底可见</text>
					</view>
					<view class="slot" hover-class="slot-hover" @click="pickImage('black')">
						<image v-if="blackImage.src" class="slot-image" :src="blackImage.src" mode="aspectFit"></image>
						<text v-else class="slot-plus">+</text>
						<text class="slot-label">黑底可见</text>
					</view>
				</view>
				<text class="link" @click="swapImages">交换两张图</text>
			</view>

			<view class="card">
				<view class="row">
					<text class="label">灰度模式</text>
					<switch class="switch" color="#5B8FF9" :checked="grayscale" @change="onGrayscaleChange" />
				</view>
				<text class="hint">灰度是唯一能让两张图都精确还原的模式。关掉后黑底图保色，白底图会变成黑底图加一层亮度偏移</text>

				<view class="row row-spaced">
					<text class="label">白底图反相</text>
					<switch class="switch" color="#5B8FF9" :checked="invertWhite" @change="onInvertChange('white', $event)" />
				</view>
				<view class="row row-spaced">
					<text class="label">黑底图反相</text>
					<switch class="switch" color="#5B8FF9" :checked="invertBlack" @change="onInvertChange('black', $event)" />
				</view>

				<text class="label row-spaced">白底图亮度 {{ gainWhiteText }}</text>
				<slider
					class="slider"
					:min="gainWhiteMin"
					:max="gainWhiteMax"
					:step="gainStep"
					:value="gainWhite * gainScale"
					activeColor="#5B8FF9"
					block-size="18"
					@change="onGainChange('white', $event)"
				/>
				<text class="label">黑底图亮度 {{ gainBlackText }}</text>
				<slider
					class="slider"
					:min="gainBlackMin"
					:max="gainBlackMax"
					:step="gainStep"
					:value="gainBlack * gainScale"
					activeColor="#5B8FF9"
					block-size="18"
					@change="onGainChange('black', $event)"
				/>
				<text class="hint">效果强度 = 两张图在同一像素上的亮度差。黑底那张默认压到 0.30（这类工具的标准做法）：压暗后差值才会有 90 左右，两个底才差得明显。调回 1.00 可以保真，但两张普通照片的差接近 0，看起来就是一样的</text>

				<text class="label row-spaced">长边上限</text>
				<view class="pills">
					<view
						v-for="option in edgeOptions"
						:key="option"
						class="pill"
						:class="{ 'pill-active': edge === option }"
						@click="setEdge(option)"
					>
						<text class="pill-text">{{ option }}</text>
					</view>
				</view>
				<text class="hint">越大越清晰也越慢，小程序和 App 上建议先用 720</text>
			</view>

			<view class="actions">
				<button class="btn btn-primary" :disabled="!bothPicked || busy" @click="generate">
					{{ busy ? '处理中...' : '生成' }}
				</button>
				<button class="btn btn-plain" :disabled="!resultSrc || busy" @click="saveResult">保存图片</button>
			</view>

			<text v-if="dirty && resultSrc" class="notice">参数改过了，点「生成」刷新预览</text>
			<text v-if="statsText" class="notice">{{ statsText }}</text>
		</block>

		<!-- ==================== 解码 ==================== -->
		<block v-else>
			<view class="card">
				<text class="label">选择幻影坦克图片</text>
				<text class="hint">选完会自动解析：把这张图在 JS 里分别按白底和黑底合成，结果显示在下面。不靠「PNG 叠在背景上」预览，所以不受渲染层怎么处理透明通道影响</text>
				<view class="slot slot-wide" hover-class="slot-hover" @click="pickImage('tank')">
					<image v-if="tankImage.src" class="slot-image" :src="tankImage.src" mode="aspectFit"></image>
					<text v-else class="slot-plus">+</text>
				</view>
			</view>

			<view class="actions">
				<button class="btn btn-plain" :disabled="!tankImage.src || busy" @click="parseTank">重新解析</button>
			</view>
			<view class="actions">
				<button class="btn btn-plain" :disabled="!previewWhite || busy" @click="saveFlat(255)">存白底版本</button>
				<button class="btn btn-plain" :disabled="!previewBlack || busy" @click="saveFlat(0)">存黑底版本</button>
			</view>
			<text class="hint hint-block">保存的是压平后的不透明 PNG（按上面选的长边上限），不会改动你选的原图</text>
		</block>

		<!-- ========== 双预览：显示的是 JS 合成好的不透明图，不靠 CSS 背景透出 ========== -->
		<view v-if="previewWhite || previewBlack" class="previews">
			<view class="preview">
				<text class="preview-title">白底下的效果（JS 合成）</text>
				<view class="stage stage-white">
					<image v-if="previewWhite" class="stage-image" :src="previewWhite" mode="aspectFit"></image>
				</view>
			</view>
			<view class="preview">
				<text class="preview-title">黑底下的效果（JS 合成）</text>
				<view class="stage stage-black">
					<image v-if="previewBlack" class="stage-image" :src="previewBlack" mode="aspectFit"></image>
				</view>
			</view>
		</view>
		<view v-if="diagnosisText" class="diagnosis">
			<text class="diagnosis-text">{{ diagnosisText }}</text>
		</view>
		<view v-if="selfTestLines.length" class="selftest">
			<text v-for="line in selfTestLines" :key="line" class="selftest-line">{{ line }}</text>
		</view>

		<text v-if="errorText" class="error">{{ errorText }}</text>

		<!-- ==================== 诊断 ==================== -->
		<view class="diag">
			<text class="link" @click="toggleDiag">{{ diagOpen ? '收起诊断信息' : '环境诊断' }}</text>
			<view v-if="diagOpen" class="diag-body">
				<text v-for="line in diagLines" :key="line" class="diag-line">{{ line }}</text>
				<text class="link" @click="refreshDiag">刷新</text>
				<text class="link" @click="runSelfTest">重新自检</text>
			</view>
		</view>

		<!-- 像素读写用的画布：H5 用游离 canvas，所以不需要渲染 -->
		<!-- #ifdef MP-WEIXIN -->
		<canvas
			type="2d"
			id="phantomCanvas"
			canvas-id="phantomCanvas"
			class="hidden-canvas"
			:style="canvasStyle"
		></canvas>
		<!-- #endif -->
		<!-- #ifdef APP-PLUS -->
		<canvas
			id="phantomCanvas"
			canvas-id="phantomCanvas"
			class="hidden-canvas"
			:style="canvasStyle"
		></canvas>
		<!-- #endif -->
	</view>
</template>

<script>
	import { LIMITS, planSize, encode, composite, measureAlpha } from '@/common/phantomTank.js'
	import {
		chooseImages,
		getImageSize,
		readPixels,
		exportPng,
		savePng,
		releaseImage,
		getDiagnostics,
		noteError,
		platformName
	} from '@/common/phantomTankAdapter.js'

	function emptyImage() {
		return { src: '', path: '', width: 0, height: 0 }
	}

	export default {
		data() {
			return {
				mode: 'encode',
				tabs: [
					{ value: 'encode', label: '编码' },
					{ value: 'decode', label: '解码' }
				],
				whiteImage: emptyImage(),
				blackImage: emptyImage(),
				tankImage: emptyImage(),
				grayscale: true,
				invertWhite: false,
				invertBlack: false,
				gainWhite: LIMITS.gainWhiteDefault / LIMITS.gainScale,
				// 黑底那张默认压到 0.30，这是效果强度的来源
				gainBlack: LIMITS.gainBlackDefault / LIMITS.gainScale,
				gainScale: LIMITS.gainScale,
				gainStep: LIMITS.gainStep,
				gainWhiteMin: LIMITS.gainWhiteRange[0],
				gainWhiteMax: LIMITS.gainWhiteRange[1],
				gainBlackMin: LIMITS.gainBlackRange[0],
				gainBlackMax: LIMITS.gainBlackRange[1],
				edge: LIMITS.edgeDefault,
				edgeOptions: LIMITS.edgeOptions,
				resultSrc: '',
				previewWhite: '',
				previewBlack: '',
				stats: null,
				dirty: false,
				busy: false,
				errorText: '',
				canvasWidth: 300,
				canvasHeight: 300,
				diagOpen: false,
				diagLines: [],
				selfTestLines: [],
				selfTestAlpha: null
			}
		},
		computed: {
			bothPicked() {
				return !!(this.whiteImage.path && this.blackImage.path)
			},
			gainWhiteText() {
				return this.gainWhite.toFixed(2) + 'x'
			},
			gainBlackText() {
				return this.gainBlack.toFixed(2) + 'x'
			},
			canvasStyle() {
				return 'width: ' + this.canvasWidth + 'px; height: ' + this.canvasHeight + 'px;'
			},
			statsText() {
				if (!this.stats) return ''
				const stats = this.stats
				return (
					'两底平均亮度差 ' + stats.meanDiff.toFixed(1) + '/255（即效果强度），' +
					'相同像素 ' + (stats.opaqueRatio * 100).toFixed(1) + '%；' +
					'alpha ' + stats.alphaMin + '~' + stats.alphaMax
				)
			},
			// 直接把结论说出来，不让人去读数字。判断顺序很重要：
			// 编码结果本身就不透明时，导出测出来也必然不透明，
			// 所以必须先归因到输入图，否则会把输入问题误判成平台问题。
			diagnosisText() {
				if (!this.previewWhite || this.mode !== 'encode') return ''
				const stats = this.stats
				const measured = this.selfTestAlpha
				// 平均亮度差就是两个预览看起来差多少，10 以内基本看不出来。
				// 这个判断必须排在导出检查前面：差值本来就接近 0 时，
				// 导出测出来也一定接近「完全不透明」，否则会把输入问题误判成平台问题。
				if (stats && stats.meanDiff < 10) {
					return (
						'诊断：两个底的平均亮度差只有 ' + stats.meanDiff.toFixed(1) +
						'/255 —— 差值多小，两个预览看起来就差多少，所以看着一样。' +
						'把「黑底图亮度」调低（默认 0.30）再生成一次'
					)
				}
				if (measured && measured.notOpaque === 0) {
					return '诊断：编码确实产生了透明度，但导出后的 PNG 完全不透明 —— 透明通道是在导出环节被平台拍平的，这就是两张预览一样的原因'
				}
				if (measured && measured.max > measured.min) {
					return (
						'诊断：编码产生了透明度、导出也保住了透明通道，两底平均亮度差 ' +
						stats.meanDiff.toFixed(1) + '/255。如果预览看起来还是一样，把这行字发我'
					)
				}
				return ''
			}
		},
		methods: {
			switchMode(value) {
				if (this.mode === value) return
				this.mode = value
				this.errorText = ''
			},

			async pickImage(kind) {
				try {
					this.errorText = ''
					const paths = await chooseImages(1)
					if (!paths || !paths.length) return
					const info = await getImageSize(paths[0])
					const image = {
						src: paths[0],
						path: info.path || paths[0],
						width: info.width,
						height: info.height
					}
					if (kind === 'white') {
						this.whiteImage = image
						this.markDirty()
					} else if (kind === 'black') {
						this.blackImage = image
						this.markDirty()
					} else {
						this.tankImage = image
						// 选完直接解析，省一次点击
						this.parseTank()
					}
				} catch (error) {
					this.fail('选择图片失败', error, this.pickHint(error))
				}
			},

			// 相册权限一旦被拒绝，系统不会再弹窗，只能去设置里手动打开
			pickHint(error) {
				const message = (error && (error.message || error.errMsg)) || String(error)
				if (/permission|auth deny|denied/i.test(message)) {
					return '权限被拒过之后系统不会再弹窗，请到手机「设置 → 应用 → 本应用 → 权限」里手动打开照片 / 存储权限'
				}
				if (platformName() === 'app') {
					return '可以先到手机「设置 → 应用 → 本应用 → 权限」确认照片 / 存储已允许；如果是刚改过 manifest 里的权限或模块，需要重新制作自定义调试基座才会生效'
				}
				return ''
			},

			swapImages() {
				const white = this.whiteImage
				this.whiteImage = this.blackImage
				this.blackImage = white
				this.markDirty()
			},

			onGrayscaleChange(event) {
				this.grayscale = event.detail.value
				this.markDirty()
			},

			onInvertChange(kind, event) {
				if (kind === 'white') this.invertWhite = event.detail.value
				else this.invertBlack = event.detail.value
				this.markDirty()
			},

			onGainChange(kind, event) {
				// 滑块是 80~140 的整数档位，除回 100 才是亮度倍数
				const gain = Number(event.detail.value) / this.gainScale
				if (kind === 'white') this.gainWhite = gain
				else this.gainBlack = gain
				this.markDirty()
			},

			setEdge(value) {
				if (this.edge === value) return
				this.edge = value
				this.markDirty()
			},

			markDirty() {
				this.dirty = true
				// 参数变了，上一次的自检结论就不再对应当前结果，
				// 留着会和新的编码统计混在一起给出错误诊断
				this.selfTestLines = []
				this.selfTestAlpha = null
			},

			// 目标尺寸同时决定隐藏画布的 CSS 尺寸（App 端旧版 canvas 按这个尺寸绘制）
			async prepareCanvas(width, height) {
				this.canvasWidth = width
				this.canvasHeight = height
				await this.$nextTick()
				// #ifdef APP-PLUS
				// 旧版 canvas 改尺寸后立刻绘制可能用到旧的画布尺寸，给它一点时间
				await new Promise((resolve) => setTimeout(resolve, 80))
				// #endif
			},

			async generate() {
				if (!this.bothPicked) {
					uni.showToast({ title: '请先选择两张图片', icon: 'none' })
					return
				}
				if (this.busy) return
				this.busy = true
				this.errorText = ''
				uni.showLoading({ title: '合成中...' })
				try {
					const reference = this.whiteImage
					const target = planSize(reference.width, reference.height, this.edge)
					await this.prepareCanvas(target.width, target.height)

					const onWhite = await readPixels(this.whiteImage.path, target, this.whiteImage, this)
					const onBlack = await readPixels(this.blackImage.path, target, this.blackImage, this)

					const encoded = encode({
						onWhite,
						onBlack,
						options: {
							grayscale: this.grayscale,
							invertWhite: this.invertWhite,
							invertBlack: this.invertBlack,
							gainWhite: this.gainWhite,
							gainBlack: this.gainBlack
						}
					})

					await this.releasePreviews()
					// 真实产物：带透明通道的 PNG，保存下去给别人用
					const exported = await exportPng(encoded)
					// 两个底的合成结果在 JS 里算好再显示。不能靠「PNG 叠在 CSS 背景上」来
					// 预览：App 端 <image> 不会把父容器背景透出来，那样两个预览必然一样。
					// 这里显示的是不透明图，渲染层怎么处理 alpha 都影响不到它。
					const whiteFlat = await exportPng(composite({ image: encoded, background: 255 }))
					const blackFlat = await exportPng(composite({ image: encoded, background: 0 }))
					this.resultSrc = exported.src
					this.previewWhite = whiteFlat.src
					this.previewBlack = blackFlat.src
					this.stats = encoded.stats
					this.dirty = false
					// 顺手自检：把刚导出的 PNG 读回来量一次 alpha，
					// 这样「两张预览一样」到底是编码没产生透明度、还是导出丢了 alpha，一眼能分清
					await this.selfTest()
					uni.hideLoading()
				} catch (error) {
					uni.hideLoading()
					this.fail('生成失败', error)
				}
				this.busy = false
			},

			async saveResult() {
				if (!this.resultSrc || this.busy) return
				this.busy = true
				try {
					await savePng(this.resultSrc, 'phantom-tank.png')
					uni.showToast({ title: '已保存' })
				} catch (error) {
					this.fail('保存失败', error)
				}
				this.busy = false
			},

			// H5 上导出的是 blob URL，换一批之前显式回收，否则每生成一次漏几 MB
			releasePreviews() {
				releaseImage(this.resultSrc)
				releaseImage(this.previewWhite)
				releaseImage(this.previewBlack)
				this.resultSrc = ''
				this.previewWhite = ''
				this.previewBlack = ''
			},

			// 解码：把幻影坦克图读成像素，在 JS 里分别按白底/黑底合成，
			// 显示的是合成后的不透明图，同样不依赖渲染层处理 alpha
			async parseTank() {
				if (!this.tankImage.path || this.busy) return
				this.busy = true
				this.errorText = ''
				uni.showLoading({ title: '解析中...' })
				try {
					const source = this.tankImage
					const target = planSize(source.width, source.height, this.edge)
					await this.prepareCanvas(target.width, target.height)
					const pixels = await readPixels(source.path, target, source, this)
					await this.releasePreviews()
					const whiteFlat = await exportPng(composite({ image: pixels, background: 255 }))
					const blackFlat = await exportPng(composite({ image: pixels, background: 0 }))
					this.previewWhite = whiteFlat.src
					this.previewBlack = blackFlat.src
					uni.hideLoading()
				} catch (error) {
					uni.hideLoading()
					this.fail('解析失败', error)
				}
				this.busy = false
			},

			// 保存的是上面已经合成好的不透明图，不用再算一遍
			async saveFlat(background) {
				const src = background === 255 ? this.previewWhite : this.previewBlack
				if (!src || this.busy) return
				this.busy = true
				try {
					await savePng(src, background === 255 ? 'phantom-white.png' : 'phantom-black.png')
					uni.showToast({ title: background === 255 ? '已保存白底版本' : '已保存黑底版本' })
				} catch (error) {
					this.fail('保存失败', error)
				}
				this.busy = false
			},

			/**
			 * 自检：把导出后的 PNG 重新读回来测 alpha。
			 * 这是分辨「编码没产生透明度」和「导出丢了透明通道」的唯一可靠手段，
			 * 因为两条路的修法完全不同。内部自己吞掉异常，绝不打断生成流程。
			 */
			async selfTest() {
				if (!this.resultSrc) return
				try {
					const info = await getImageSize(this.resultSrc)
					// 画布尺寸必须与要读的图一致（App 端旧版 canvas 尤其如此），
					// 否则可能读到被裁掉的内容，误判成「导出丢了 alpha」
					await this.prepareCanvas(info.width, info.height)
					const pixels = await readPixels(
						this.resultSrc,
						{ width: info.width, height: info.height },
						info,
						this
					)
					const measured = measureAlpha(pixels)
					this.selfTestAlpha = measured
					const percent = (measured.notOpaqueRatio * 100).toFixed(1)
					const lines = [
						'自检（把导出后的 PNG 读回来量）：' + info.width + 'x' + info.height,
						'导出后 alpha：' + measured.min + '~' + measured.max +
							'，均值 ' + measured.mean.toFixed(1),
						'非全不透明像素：' + percent + '%'
					]
					if (measured.max === 0) {
						lines.push('结论：读回来是全 0，说明这次自检根本没读到文件内容（画布是空的），结果不可信，请重试')
					} else if (measured.notOpaque === 0) {
						lines.push('结论：导出后的 PNG 完全不透明 —— 透明通道是在导出环节丢的，这就是两张预览一样的原因')
					} else if (measured.min === measured.max) {
						lines.push('结论：导出后 alpha 是个恒定值 —— 编码阶段就基本没产生透明度，看上面的「压平」比例')
					} else {
						lines.push('结论：导出后透明通道是好的；若预览仍一样，看上面的「压平」比例和 alpha 范围')
					}
					this.selfTestLines = lines
				} catch (error) {
					const message = (error && (error.message || error.errMsg)) || String(error)
					this.selfTestLines = ['自检失败：' + message]
				}
			},

			async runSelfTest() {
				if (!this.resultSrc) {
					uni.showToast({ title: '先在编码页生成一张', icon: 'none' })
					return
				}
				if (this.busy) return
				this.busy = true
				uni.showLoading({ title: '自检中...' })
				await this.selfTest()
				uni.hideLoading()
				this.busy = false
			},

			toggleDiag() {
				this.diagOpen = !this.diagOpen
				if (this.diagOpen) this.refreshDiag()
			},

			refreshDiag() {
				const info = getDiagnostics()
				this.diagLines = [
					'平台：' + info.platform + '（' + info.system + '）',
					'canvas 节点：' + info.canvasNode,
					'最近读到的像素：' + info.readBytes + ' 字节',
					'alpha 抽样：' + info.alphaNonZero + '/' + info.alphaSamples + ' 个非零',
					'最近一次错误：' + (info.lastError || '无')
				]
			},

			fail(title, error, hint) {
				const message = (error && (error.message || error.errMsg)) || String(error)
				this.errorText = title + '：' + message + (hint ? '\n' + hint : '')
				noteError(title + '：' + message)
				if (this.diagOpen) this.refreshDiag()
				uni.showToast({ title: title, icon: 'none' })
				console.error('[phantom-tank] ' + title, error)
			}
		}
	}
</script>

<style>
	.page {
		min-height: 100vh;
		padding: 32rpx 24rpx 64rpx;
		box-sizing: border-box;
		background-color: #F5F6FA;
	}

	.tabs {
		margin-bottom: 24rpx;
		padding: 8rpx;
		display: flex;
		flex-direction: row;
		background-color: #EAEBF0;
		border-radius: 18rpx;
	}

	.tab {
		flex: 1;
		height: 68rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 14rpx;
	}

	.tab-active {
		background-color: #FFFFFF;
		box-shadow: 0 2rpx 8rpx rgba(31, 35, 41, 0.08);
	}

	.tab-hover {
		opacity: 0.7;
	}

	.tab-text {
		font-size: 28rpx;
		color: #8F9299;
	}

	.tab-active .tab-text {
		color: #1F2329;
		font-weight: 500;
	}

	.card {
		margin-bottom: 24rpx;
		padding: 32rpx 28rpx;
		background-color: #FFFFFF;
		border-radius: 20rpx;
		box-shadow: 0 4rpx 16rpx rgba(31, 35, 41, 0.06);
	}

	.label {
		display: block;
		font-size: 30rpx;
		font-weight: 500;
		color: #1F2329;
	}

	.hint {
		display: block;
		margin-top: 10rpx;
		font-size: 24rpx;
		line-height: 36rpx;
		color: #8F9299;
	}

	.hint-block {
		margin-top: 16rpx;
		padding: 0 8rpx;
	}

	.row {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}

	.row-spaced {
		margin-top: 32rpx;
	}

	.switch {
		transform: scale(0.85);
	}

	.slider {
		margin: 8rpx 0 0;
	}

	.slots {
		margin-top: 20rpx;
		display: flex;
		flex-direction: row;
	}

	.slot {
		flex: 1;
		height: 220rpx;
		margin-right: 20rpx;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background-color: #F2F3F7;
		border-radius: 16rpx;
		overflow: hidden;
	}

	.slot:last-child {
		margin-right: 0;
	}

	.slot-wide {
		width: 100%;
		height: 300rpx;
		margin: 20rpx 0 0;
	}

	.slot-hover {
		opacity: 0.7;
	}

	.slot-image {
		width: 100%;
		flex: 1;
	}

	.slot-plus {
		font-size: 56rpx;
		color: #B6BAC3;
	}

	.slot-label {
		margin: 8rpx 0 12rpx;
		font-size: 24rpx;
		color: #8F9299;
	}

	.link {
		display: block;
		margin-top: 20rpx;
		font-size: 26rpx;
		color: #5B8FF9;
	}

	.pills {
		margin-top: 16rpx;
		display: flex;
		flex-direction: row;
	}

	.pill {
		flex: 1;
		height: 64rpx;
		margin-right: 16rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: #F2F3F7;
		border-radius: 14rpx;
	}

	.pill:last-child {
		margin-right: 0;
	}

	.pill-active {
		background-color: #E8F0FE;
	}

	.pill-text {
		font-size: 26rpx;
		color: #5A5F6B;
	}

	.pill-active .pill-text {
		color: #5B8FF9;
		font-weight: 500;
	}

	.actions {
		margin-bottom: 24rpx;
		display: flex;
		flex-direction: row;
	}

	.btn {
		flex: 1;
		margin: 0 8rpx;
		font-size: 30rpx;
		border-radius: 44rpx;
	}

	.btn-primary {
		background-color: #5B8FF9;
		color: #FFFFFF;
	}

	.btn-primary[disabled] {
		background-color: #B9CFFB;
		color: #FFFFFF;
	}

	.btn-plain {
		background-color: #FFFFFF;
		color: #5A5F6B;
	}

	.btn-plain[disabled] {
		color: #B6BAC3;
	}

	.previews {
		margin-bottom: 24rpx;
	}

	.preview {
		margin-bottom: 24rpx;
	}

	.preview-title {
		display: block;
		margin-bottom: 12rpx;
		font-size: 26rpx;
		color: #8F9299;
	}

	.stage {
		height: 480rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 20rpx;
		overflow: hidden;
	}

	.stage-white {
		background-color: #FFFFFF;
		border: 2rpx solid #E6E8EE;
	}

	.stage-black {
		background-color: #000000;
	}

	.stage-image {
		width: 100%;
		height: 100%;
	}

	.notice {
		display: block;
		margin-bottom: 16rpx;
		padding: 0 8rpx;
		font-size: 24rpx;
		line-height: 36rpx;
		color: #8F9299;
	}

	.notice-safe {
		color: #5A5F6B;
	}

	.selftest {
		margin-bottom: 24rpx;
		padding: 24rpx 28rpx;
		background-color: #F2F3F7;
		border-radius: 16rpx;
	}

	.diagnosis {
		margin-bottom: 24rpx;
		padding: 24rpx 28rpx;
		background-color: #FFF7E6;
		border-radius: 16rpx;
	}

	.diagnosis-text {
		font-size: 26rpx;
		line-height: 40rpx;
		color: #8C5A12;
	}

	.selftest-line {
		display: block;
		font-size: 22rpx;
		line-height: 36rpx;
		color: #5A5F6B;
	}

	.error {
		display: block;
		margin-bottom: 16rpx;
		padding: 20rpx 24rpx;
		font-size: 24rpx;
		line-height: 36rpx;
		color: #E8684A;
		background-color: #FDF0EC;
		border-radius: 16rpx;
	}

	.diag {
		margin-top: 8rpx;
	}

	.diag-body {
		margin-top: 12rpx;
		padding: 20rpx 24rpx;
		background-color: #F2F3F7;
		border-radius: 16rpx;
	}

	.diag-line {
		display: block;
		font-size: 22rpx;
		line-height: 34rpx;
		color: #5A5F6B;
	}

	.hidden-canvas {
		position: fixed;
		left: -9999px;
		top: 0;
	}
</style>
