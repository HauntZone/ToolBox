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

		<!-- ==================== 制作 ==================== -->
		<block v-if="mode === 'encode'">
			<view class="card">
				<text class="label">选择两张图片</text>
				<text class="hint">里图决定输出尺寸和比例，表图按它的比例居中裁剪，所以两张尺寸不同也能用</text>
				<view class="slots">
					<view class="slot" hover-class="slot-hover" @click="pickImage('cover')">
						<image v-if="coverImage.src" class="slot-image" :src="coverImage.src" mode="aspectFit"></image>
						<text v-else class="slot-plus">+</text>
						<text class="slot-label">表图（看得见）</text>
					</view>
					<view class="slot" hover-class="slot-hover" @click="pickImage('inner')">
						<image v-if="innerImage.src" class="slot-image" :src="innerImage.src" mode="aspectFit"></image>
						<text v-else class="slot-plus">+</text>
						<text class="slot-label">里图（藏起来）</text>
					</view>
				</view>
				<text class="link" @click="swapImages">交换两张图</text>
				<text class="hint">两张图按棋盘格交错，各只占一半像素，所以有效分辨率减半 —— 长边别选太小，里图别放小字</text>
			</view>

			<view class="card">
				<tool-slider
					label="表图色阶端"
					:value="coverThreshold"
					:min="coverThresholdMin"
					:max="coverThresholdMax"
					:step="thresholdStep"
					@changing="onCoverThresholdChanging"
					@change="onCoverThresholdChange"
				></tool-slider>
				<text class="hint">表图的亮度被压进「色阶端 ~ 255」。调大 → 表图更灰、里图的亮度带更宽（量化台阶更少，但正常观看时那层噪点更明显）；调小则相反</text>

				<tool-slider
					label="里图色阶端"
					:value="innerThreshold"
					:min="innerThresholdMin"
					:max="innerThresholdMax"
					:step="thresholdStep"
					:spaced="true"
					@changing="onInnerThresholdChanging"
					@change="onInnerThresholdChange"
				></tool-slider>
				<text class="hint">里图的亮度被压进「0 ~ 色阶端」，显形时再把这一段拉伸回全量程。它必须小于表图色阶端，否则两张图的亮度带会重叠。这个值越大，里图还原得越准（误差约 255 ÷ 色阶端，默认 24 时约 10 级），代价是正常观看时噪点更明显</text>
				<text v-if="thresholdError" class="inline-error">{{ thresholdError }}</text>

				<view class="row row-spaced">
					<text class="label">反相</text>
					<switch class="switch" color="#5B8FF9" :checked="isReverse" @change="onReverseChange" />
				</view>
				<text class="hint">把两张图的亮度带对调：表图落 0 ~ (255-色阶端)，里图落 (255-色阶端) ~ 255。显形时的阈值区间也跟着变，制作完会自动帮你填好</text>

				<view class="row row-spaced">
					<text class="label">表图转灰度</text>
					<switch class="switch" color="#5B8FF9" :checked="coverGray" @change="onCoverGrayChange" />
				</view>
				<view class="row row-spaced">
					<text class="label">里图转灰度</text>
					<switch class="switch" color="#5B8FF9" :checked="innerGray" @change="onInnerGrayChange" />
				</view>
				<text class="hint">默认表图转灰度、里图保留颜色（参考实现的默认值）：正常观看时表图更像一张普通灰片，把颜色留给显形后的里图</text>

			</view>

			<view class="card">
				<tool-slider
					label="里图对比度"
					:value="innerContrast"
					:min="contrastMin"
					:max="contrastMax"
					:step="contrastStep"
					@changing="onInnerContrastChanging"
					@change="onInnerContrastChange"
				></tool-slider>
				<text class="hint">制作时「先」给里图提对比度，它才有足够的动态范围挤进那条只有几十级的窄带 —— 里图本身对比度低的时候，这一步是显形质量提升最明显的地方。这个值会写进图片元数据，显形时自动施加反向对比度还原，不用手动调</text>

				<tool-slider
					label="表图对比度"
					:value="coverContrast"
					:min="contrastMin"
					:max="contrastMax"
					:step="contrastStep"
					:spaced="true"
					@changing="onCoverContrastChanging"
					@change="onCoverContrastChange"
				></tool-slider>
				<text class="hint">作用在表图上，只影响正常观看时的观感。注意这个值「不」写进元数据（参考实现也只存里图那一个），所以显形侧不会自动还原它</text>
				<text class="hint">不合理的对比度会严重影响显形质量 —— 里图提得过高，超出带内的部分会被直接削掉</text>
				<text v-if="innerContrast !== 0 || coverContrast !== 0" class="link" @click="resetContrast">重置对比度</text>
			</view>

			<view class="card">
				<text class="label">交错方式</text>
				<view class="pills">
					<view
						v-for="option in rowOptions"
						:key="String(option.value)"
						class="pill"
						:class="{ 'pill-active': isRow === option.value }"
						@click="setRow(option.value)"
					>
						<text class="pill-text">{{ option.label }}</text>
					</view>
				</view>
				<text class="hint">按行就是把条纹横着铺，按列是竖着铺。默认的「按行 + 间隔 1 + 斜向 1」就是标准棋盘格</text>

				<tool-slider
					label="间隔"
					:value="gap"
					:min="gapMin"
					:max="gapMax"
					:step="1"
					:spaced="true"
					@changing="onGapChanging"
					@change="onGapChange"
				></tool-slider>
				<text class="hint">条纹占 {{ gap }} 格、空 1 格，所以里图占 1/{{ gap + 1 }} 的像素。间隔越大表图越完整，但里图能用的采样点越少、显形越糊。「间隔大于 1 时显形那边的『扩散迭代次数』才有作用」—— 那时才会有覆盖像素在第一轮找不到可用的邻居</text>

				<tool-slider
					label="斜向"
					:value="slope"
					:min="slopeMin"
					:max="slopeMax"
					:step="1"
					:spaced="true"
					@changing="onSlopeChanging"
					@change="onSlopeChange"
				></tool-slider>
				<text class="hint">0 表示不斜（整行 / 整列地切），1 以上把条纹压斜成一个角度。只改观感，不影响能不能显形</text>

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
				<text class="hint">越大越清晰也越慢。一次全分辨率生成要跑两遍 PNG 编码，小程序和 App 上建议先用 720</text>
			</view>

			<view class="actions">
				<button class="btn btn-primary" :disabled="!bothPicked || !!thresholdError || busy" @click="generate">
					{{ busy ? '处理中...' : '生成' }}
				</button>
				<button class="btn btn-plain" :disabled="!resultSrc || busy || staleFull" @click="saveResult">保存图片</button>
			</view>

			<text v-if="staleFull" class="notice">正在按全分辨率重算，出来之前先别保存</text>
			<text v-if="dirty && resultSrc" class="notice">参数改过了，点「生成」刷新预览</text>
			<text v-if="statsText" class="notice">{{ statsText }}</text>
			<text class="notice">导出的是 PNG，且一定要按「原图 / 文件」发出去。聊天软件按普通图片发送会重新压缩，里图那条亮度带只有几十级，一压就没了</text>
		</block>

		<!-- ==================== 显形 ==================== -->
		<block v-else>
			<view class="card">
				<text class="label">选择光棱坦克图片</text>
				<text class="hint">选完会自动显形：把亮度落在阈值区间里的像素拉伸回全量程。区间外的像素按下面选的方式处理</text>
				<view class="slot slot-wide" hover-class="slot-hover" @click="pickImage('prism')">
					<image v-if="prismImage.src" class="slot-image" :src="prismImage.src" mode="aspectFit"></image>
					<text v-else class="slot-plus">+</text>
				</view>

				<view class="row row-spaced">
					<text class="label">按原尺寸显形</text>
					<switch class="switch" color="#5B8FF9" :checked="decodeNativeSize" @change="onDecodeNativeSizeChange" />
				</view>
				<text class="hint">默认开：直接用源图的原始像素显形，不做任何缩放。光棱坦克是棋盘格，相邻像素一个落在表图亮度带、一个落在里图亮度带，「任何」插值缩放都会把两者平均进两带之间的空档 —— 实测把 1440×960 的图缩小 0.1% 落带比例就从 50% 掉到 9.8%，缩到 720×480 也只有 10.1%，缩多少都一样废。关掉后改用奇数步长抽样（只取原像素、不插值），实测步长 3 时落带比例仍是 50%；代价是分辨率变成 1/3，而且只对标准棋盘格安全</text>
				<text v-if="decodeFormatNotice" class="inline-error">{{ decodeFormatNotice }}</text>
				<text v-if="decodeSizeNotice" class="notice">{{ decodeSizeNotice }}</text>
				<text v-if="decodeSampleNotice" class="notice">{{ decodeSampleNotice }}</text>
			</view>

			<view class="card">
				<tool-slider
					label="阈值下界"
					:value="decodeLower"
					:min="0"
					:max="255"
					:step="thresholdStep"
					@changing="onDecodeLowerChanging"
					@change="onDecodeLowerChange"
				></tool-slider>
				<tool-slider
					label="阈值上界"
					:value="decodeHigher"
					:min="0"
					:max="255"
					:step="thresholdStep"
					:spaced="true"
					@changing="onDecodeHigherChanging"
					@change="onDecodeHigherChange"
				></tool-slider>
				<!-- 显形结果就摆在滑块正下面：拖上下界的时候不用往下翻就能看到画面跟着变 -->
				<view v-if="decodedPreview" class="previews row-spaced">
					<view class="preview">
						<text class="preview-title">显形结果</text>
						<view class="stage stage-plain">
							<image class="stage-image" :src="decodedPreview" mode="aspectFit"></image>
						</view>
						<text class="preview-note">缩小显示时相邻像素会被平均掉，看着比实际清楚；要看真实效果请点开看原图</text>
					</view>
				</view>
				<text class="hint">非反相的光棱坦克：里图落在 0 ~ 里图色阶端（默认 0~24）。反相的落在 (255-色阶端) ~ 255（默认 231~255）。上界拖大会更亮，但表图的残影也会一起进来</text>
				<text class="link" @click="prefillFromEncode">按上次制作参数预填</text>
				<text class="link" @click="autoDetectRange">从图本身自动检测阈值</text>
				<view class="row row-spaced">
					<text class="label">这张图是反相的</text>
					<switch class="switch" color="#5B8FF9" :checked="decodeIsReverse" @change="onDecodeReverseChange" />
				</view>
				<text class="hint">选图时会按顺序试：先读图像自带的显形参数（参考实现写在 PNG 的 tEXt 块里，我们自己导出的图也写），读不到就从「图本身」反推阈值 —— 里图恒占一半像素且都在暗带里，所以「亮度最低的那一半到哪里为止」就是阈值。两条都拿不到才用手上的值。上面两个按钮分别是手动填上次制作的参数、和强制重新反推；反相开关只影响反推时往哪个方向找</text>

				<text class="label row-spaced">区间外的像素怎么处理</text>
				<view class="pills pills-wrap">
					<view
						v-for="option in methodOptions"
						:key="option.value"
						class="pill"
						:class="{ 'pill-active': decodeMethod === option.value }"
						@click="setDecodeMethod(option.value)"
					>
						<text class="pill-text">{{ option.label }}</text>
					</view>
				</view>
				<text class="hint">区间外的像素是表图，得靠邻居把它补出来。扩散填充是参考实现的做法（默认值）：反复取周围 24 个邻居里「已经确定」的那些加权平均，而第一轮里「已经确定」的全是真里图像素，所以填出来的值全部来自真实采样，不掺任何猜出来的数。黑色 / 白色更干净但会留网格；透明适合再加工</text>

				<tool-slider
					v-if="decodeMethod === 'ltavg'"
					label="扩散迭代次数"
					:value="decodeIterations"
					:min="0"
					:max="iterationsMax"
					:step="1"
					:spaced="true"
					@changing="onDecodeIterationsChanging"
					@change="onDecodeIterationsChange"
				></tool-slider>
				<text v-if="decodeMethod === 'ltavg'" class="hint">标准棋盘格（间隔 1）下第一轮就能填满，这个值调多少结果都逐字节相同 —— 所以正常情况下它没有作用（实测 1 轮和 100 轮完全一致）。只有拿到间隔大于 1 的图，也就是别的工具用非默认交错做的图，才需要往上调</text>

				<view v-if="decodeMethod === 'ltavg'" class="row row-spaced">
					<text class="label">锐化填充</text>
					<switch class="switch" color="#5B8FF9" :checked="sharpenFill" @change="onSharpenFillChange" />
				</view>
				<text v-if="decodeMethod === 'ltavg'" class="hint">默认关闭，走参考实现原样的权重。开启后换一套带负权重的核：里图那半像素本来就没有高频信息，用负权重从邻近的已知像素借一点过来，插出来的那半没那么糊。实测填充位 RMSE 5.72 → 4.12、表图位局部锐度 0.96 → 1.33（原图基准 4.01，仍然补不满）。代价是负权重会放大噪声，被有损压缩过的图开它可能反而更糙</text>
			</view>

			<view class="card">
				<tool-slider
					label="对比度"
					:value="decodeContrast"
					:min="contrastMin"
					:max="contrastMax"
					:step="contrastStep"
					@changing="onDecodeContrastChanging"
					@change="onDecodeContrastChange"
				></tool-slider>
				<text class="hint">制作时给里图提了多少对比度，这里就要反向施加多少把它还原。带元数据的图选进来会自动填好，不用手动调；这里主要是拿来救那些元数据丢了的图 —— 显形出来发灰、层次糊在一起，就往负的方向拉</text>
			</view>

			<view class="actions">
				<button class="btn btn-plain" :disabled="!prismImage.path || busy" @click="decodeImage">重新显形</button>
				<button class="btn btn-plain" :disabled="!decodedRaw || busy || staleFull" @click="saveDecoded">保存显形结果</button>
			</view>
			<view v-if="presetInfo" class="preset">
				<text class="preset-text">{{ presetInfo }}</text>
			</view>
			<text v-if="staleFull" class="notice">正在按全分辨率重算，出来之前先别保存</text>
			<text v-if="decodeLiveSkipped" class="notice">这张图太大，拖动时不刷新预览，松手后重算</text>
			<text v-if="decodeStatsText" class="notice">{{ decodeStatsText }}</text>
		</block>

		<!-- ========== 预览：显示的都是 JS 合成好的不透明图，不靠 CSS 背景透出 ========== -->
		<view v-if="mode === 'encode' && (resultSrc || revealPreview)" class="previews">
			<view class="preview">
				<text class="preview-title">合成图外观（正常观看就是这样）</text>
				<view class="stage stage-plain">
					<image v-if="resultSrc" class="stage-image" :src="resultSrc" mode="aspectFit"></image>
				</view>
			</view>
			<view class="preview">
				<text class="preview-title">模拟显形（用这套参数该用的阈值算出来的）</text>
				<view class="stage stage-plain">
					<image v-if="revealPreview" class="stage-image" :src="revealPreview" mode="aspectFit"></image>
				</view>
				<text class="preview-note">这一张是纯 JS 算的，不经过任何平台导出。它显不出里图就说明参数不对，不是平台的问题。改参数时它只按降分辨率实时刷新，松手后才出全分辨率；上面的「合成图外观」是棋盘格，缩小时网格会被平均掉，只在松手后刷新</text>
			</view>
		</view>

		<view v-if="diagnosisText" class="diagnosis">
			<text class="diagnosis-text">{{ diagnosisText }}</text>
		</view>

		<text v-if="errorText" class="error">{{ errorText }}</text>

		<!-- ==================== 诊断 ==================== -->
		<view class="diag">
			<text class="link" @click="toggleDiag">{{ diagOpen ? '收起诊断信息' : '环境诊断' }}</text>
			<view v-if="diagOpen" class="diag-body">
				<text v-for="line in diagLines" :key="line" class="diag-line">{{ line }}</text>
				<text class="link" @click="refreshDiag">刷新</text>
			</view>
		</view>

		<!-- 像素读写用的画布：H5 用游离 canvas，所以不需要渲染 -->
		<!-- #ifdef MP-WEIXIN -->
		<canvas
			type="2d"
			id="prismCanvas"
			canvas-id="prismCanvas"
			class="hidden-canvas"
			:style="canvasStyle"
		></canvas>
		<!-- #endif -->
		<!-- #ifdef APP-PLUS -->
		<canvas
			id="prismCanvas"
			canvas-id="prismCanvas"
			class="hidden-canvas"
			:style="canvasStyle"
		></canvas>
		<!-- #endif -->
	</view>
</template>

<script>
	// 显式引入而不是只靠 easycom：万一 easycom 没生效，页面会直接报
	// 「Unknown custom element: <tool-slider>」，而这里没法本地编译排查
	import ToolSlider from '@/components/tool-slider/tool-slider.vue'
	import {
		LIMITS,
		DECODE_LOWER_DEFAULT,
		DECODE_HIGHER_DEFAULT,
		encode,
		decode,
		validateEncodeOptions,
		encodePreset,
		decodePreset,
		detectDecodeRange,
		isPlausibleInnerRatio
	} from '@/common/prismTank.js'
	import {
		planSize,
		planOddStep,
		sampleImageOddStep,
		composite,
		downsampleImage,
		EDGE_HARD
	} from '@/common/imageGeometry.js'
	import { readPngText } from '@/common/pngWriter.js'
	import { isPng } from '@/common/pngReader.js'
	import {
		chooseImages,
		getImageSize,
		readPixels,
		readFileBytes,
		exportPng,
		savePng,
		releaseImage,
		getDiagnostics,
		noteError,
		platformName
	} from '@/common/prismTankAdapter.js'

	function emptyImage() {
		return { src: '', path: '', width: 0, height: 0 }
	}

	export default {
		components: { ToolSlider },
		data() {
			return {
				mode: 'encode',
				tabs: [
					{ value: 'encode', label: '制作' },
					{ value: 'decode', label: '显形' }
				],
				coverImage: emptyImage(),
				innerImage: emptyImage(),
				prismImage: emptyImage(),
				coverThreshold: LIMITS.coverThresholdDefault,
				innerThreshold: LIMITS.innerThresholdDefault,
				coverThresholdMin: LIMITS.coverThresholdRange[0],
				coverThresholdMax: LIMITS.coverThresholdRange[1],
				innerThresholdMin: LIMITS.innerThresholdRange[0],
				innerThresholdMax: LIMITS.innerThresholdRange[1],
				thresholdStep: LIMITS.thresholdStep,
				isReverse: false,
				coverGray: true,
				innerGray: false,
				// 对比度：制作时分别加在两张源图上，显形时施加反向的那一个还原
				innerContrast: LIMITS.contrastDefault,
				coverContrast: LIMITS.contrastDefault,
				contrastMin: LIMITS.contrastRange[0],
				contrastMax: LIMITS.contrastRange[1],
				contrastStep: LIMITS.contrastStep,
				// 交错：默认 slope=1 / gap=1 / 按行 就是标准棋盘格
				slope: LIMITS.slopeDefault,
				slopeMin: LIMITS.slopeRange[0],
				slopeMax: LIMITS.slopeRange[1],
				gap: LIMITS.gapDefault,
				gapMin: LIMITS.gapRange[0],
				gapMax: LIMITS.gapRange[1],
				isRow: true,
				rowOptions: [
					{ value: true, label: '按行' },
					{ value: false, label: '按列' }
				],
				decodeLower: DECODE_LOWER_DEFAULT,
				decodeHigher: DECODE_HIGHER_DEFAULT,
				decodeMethod: LIMITS.methodDefault,
				methodOptions: [
					{ value: 'ltavg', label: '扩散填充' },
					{ value: 'black', label: '黑色' },
					{ value: 'white', label: '白色' },
					{ value: 'transparent', label: '透明' }
				],
				decodeContrast: LIMITS.contrastDefault,
				decodeIterations: LIMITS.iterationsDefault,
				iterationsMax: LIMITS.maxIterations,
				// 锐化填充：默认关，走参考实现原样的权重
				sharpenFill: false,
				// 显形侧是否按源图原尺寸读像素。**默认开**：光棱坦克图是棋盘格，任何插值
				// 缩放都会把相邻的表图/里图像素平均掉（实测缩 0.1% 落带比例就从 50% 掉到
				// 9.8%），而现实里自己做的图最大也就 1440，按原尺寸读根本没有代价
				// （实测 1600×1200 只多花 41MB / 181ms）。关掉才走奇数步长抽样，见 readDecodeCache
				decodeNativeSize: true,
				// 选图时从 PNG 的 tEXt 块里读到的显形参数，读到了就在这里说一声
				presetInfo: '',
				// 选进来的文件是不是 PNG。只有 PNG 能走纯 JS 精确解码，其它格式会退回
				// canvas，而 canvas 扛不住超大尺寸 —— 提示文案据此分成两档
				prismIsPng: null,
				// 元数据有没有真的生效。没有的话就从图本身反推阈值（见 applyDetectedRange）
				presetApplied: false,
				// 已经因为"元数据和像素对不上"退回反推过了，避免来回重算
				recoveredFromBadPreset: false,
				// 反推出来的带（含空档长度和间隔），以及从元数据里读到的原始串和它给的带。
				// 都进「环境诊断」面板，出问题时直接读那几个数就够定位了
				detectedRange: null,
				metadataRaw: '',
				metadataRange: null,
				// 这张图是不是反相的。只影响「从图反推阈值」往哪个方向找；
				// 元数据里带这一位时会被覆盖
				decodeIsReverse: false,
				edge: LIMITS.edgeDefault,
				edgeOptions: LIMITS.edgeOptions,
				resultSrc: '',
				revealPreview: '',
				decodedRaw: '',
				decodedPreview: '',
				// 读像素是平台调用（慢），全分辨率 PNG 导出是 pako（也慢），拖动滑块时都不该重来。
				// 这两个缓存存的是全分辨率像素缓冲，按长边上限作废；拖动时只重跑纯逻辑
				// 并把结果降采样到 previewEdge 再导出。
				encodeCache: null,
				decodeCache: null,
				// 拖动时预览的降采样长边。这个值直接决定实时刷新的流畅度：
				// 一次实时渲染的耗时几乎全在 exportPng 的 deflate 上，而它随面积走，
				// 所以 320 -> 400 大约贵 1.5 倍。嫌卡就调小，嫌糊就调大。
				previewEdge: 400,
				// 解码缓冲超过这个像素数就不跑拖动时的实时预览。decode() 是同步的、跑在
				// 完整缓冲上，实测 24MP 一帧 1415ms 会把主线程卡住、滑块拖不动；
				// 1.9MP（现实里的上限）一帧 125ms，还在能接受的范围里，所以线划在 2MP。
				// 注意只降输出没用 —— decode 必须跑在完整像素缓冲上，省不掉。
				liveDecodeMaxPixels: 2000000,
				// 因为上面这条跳过了实时预览。和 staleFull 分开，因为「什么都没在算」和
				// 「正在重算」该说不同的话
				decodeLiveSkipped: false,
				liveBusy: false,
				livePendingKind: '',
				// 每次渲染领一个号，领到号之后才发现有更新的一轮在跑，就丢弃自己的结果。
				// 不然拖动中的实时预览可能晚于松手后的全分辨率渲染落地，把好结果覆盖掉。
				renderToken: 0,
				// 拖动期间只出了降分辨率预览，全分辨率那份还是旧的 —— 这期间不许保存
				staleFull: false,
				stats: null,
				decodeStats: null,
				dirty: false,
				busy: false,
				errorText: '',
				canvasWidth: 300,
				canvasHeight: 300,
				diagOpen: false,
				diagLines: []
			}
		},
		computed: {
			bothPicked() {
				return !!(this.coverImage.path && this.innerImage.path)
			},
			// 参数校验只在内核里做一次，页面直接复用同一个函数，避免两处规则不一致
			thresholdCheck() {
				return validateEncodeOptions({
					coverThreshold: this.coverThreshold,
					innerThreshold: this.innerThreshold
				})
			},
			thresholdError() {
				return this.thresholdCheck.valid ? '' : this.thresholdCheck.errors[0]
			},
			canvasStyle() {
				return 'width: ' + this.canvasWidth + 'px; height: ' + this.canvasHeight + 'px;'
			},
			statsText() {
				if (!this.stats) return ''
				const stats = this.stats
				return (
					'可解码裕度 ' + stats.separation + ' 级（里图 0~' + stats.innerThreshold +
					'，表图 ' + stats.coverThreshold + '~255）；' +
					'实测亮度 表图区 ' + Math.round(stats.coverMin) + '~' + Math.round(stats.coverMax) +
					'、里图区 ' + Math.round(stats.innerMin) + '~' + Math.round(stats.innerMax) +
					'；交错 ' + (stats.isRow ? '按行' : '按列') + '、间隔 ' + stats.gap +
					'、斜向 ' + stats.slope + '，里图占 ' +
					(stats.innerPixels / stats.total * 100).toFixed(1) + '%'
				)
			},
			decodeStatsText() {
				if (!this.decodeStats) return ''
				const stats = this.decodeStats
				return (
					'落在阈值带里的像素 ' + (stats.innerRatio * 100).toFixed(1) + '%（' +
					stats.innerPixels + '/' + stats.total + '），显影方式「' +
					this.methodLabel(stats.method) + '」' +
					(stats.method === 'ltavg'
						? (stats.sharpenFill ? '（锐化填充）' : '（参考实现原样权重）')
						: '')
				)
			},
			// 关掉「按原尺寸显形」之后这张图会被抽到多大。只在提示里用，不参与读像素
			decodePlan() {
				return planOddStep(this.prismImage.width, this.prismImage.height, this.edge)
			},

			// 按原尺寸显形一遍大概要多少内存。实测（RSS 增量，含两次 PNG 导出）：
			// 1600×1200 → +41M，6000×4000 → +599M，约为 RGBA 缓冲的 6.5 倍。
			// 只是给用户判断「这张图值不值得按原尺寸跑」用的量级估计，别当精确值
			decodeMemoryMB() {
				const image = this.prismImage
				if (!image.width || !image.height) return 0
				return Math.round((image.width * image.height * 4 * 6.5) / 1048576)
			},

			// 不是 PNG、而且大到 canvas 扛不住时才报警。
			// **小图的非 PNG 不该报**：那条路（画进 canvas 再读像素）本来就支持，读出来的像素
			// 也是对的；只有超过 EDGE_HARD 才会真正出事 —— 那个上限就是为 canvas 的内存立的。
			//
			// 注意这条**没法靠关掉开关来规避**：抽样是在读完像素之后做的，读像素那一趟永远
			// 按源图尺寸走。所以提示只能给一条真的能做到的出路（转成 PNG 或先缩小）。
			decodeFormatNotice() {
				const image = this.prismImage
				if (this.prismIsPng !== false || !image.path) return ''
				const longEdge = Math.max(image.width, image.height)
				if (longEdge <= EDGE_HARD) return ''
				return (
					'这张图不是 PNG，长边 ' + longEdge + ' 又超过了 ' + EDGE_HARD + ' —— 只有 PNG 能走纯 JS ' +
					'逐字节精确解码，其它格式只能退回系统 canvas，而 canvas 扛不住这么大的尺寸' +
					'（按它的像素算，显形一遍约 ' + this.decodeMemoryMB + 'MB），在小程序 / App 上很可能直接崩。' +
					'光棱坦克图本来就该是 PNG（本页导出的就是）：请先把它转成 PNG（或缩到 ' + EDGE_HARD + ' 以内）再试'
				)
			},

			// 这张图比「长边上限」大、而且现在正按原尺寸显形时，说清楚「按原尺寸是准的」和
			// 「关掉开关会缩到多少」，让用户自己拍板。光棱坦克图超过上限其实很少见（自己做最大 1440）。
			// 开关已经关掉时不显示 —— 那时下面那条「抽样提示」讲的是同一件事
			decodeSizeNotice() {
				const image = this.prismImage
				if (!this.decodeNativeSize || !image.path || !image.width) return ''
				const longEdge = Math.max(image.width, image.height)
				if (longEdge <= this.edge) return ''
				const plan = this.decodePlan
				return (
					'这张图长边 ' + longEdge + '，比「长边上限」' + this.edge + ' 大。' +
					'按原尺寸显形不缩放、像素是准的，代价是占内存（这张图约 ' + this.decodeMemoryMB + 'MB）与拖动变卡；' +
					'关掉上面的开关会按步长 ' + plan.step + ' 抽样到 ' +
					plan.width + '×' + plan.height + '（低分辨率，但棋盘格完好、仍能显形）'
				)
			},

			// 当前正在用抽样缩小。必须说清楚它的已知限制：只对标准棋盘格成立
			decodeSampleNotice() {
				const cache = this.decodeCache
				if (!cache || cache.step <= 1) return ''
				const image = this.prismImage
				return (
					'当前按步长 ' + cache.step + ' 抽样，显形用的是 ' +
					cache.pixels.width + '×' + cache.pixels.height +
					'（源图 ' + image.width + '×' + image.height + '），结果是低分辨率的。' +
					'抽样只对标准棋盘格（斜向 1、间隔 1）安全 —— 间隔 ≥2 的图显形侧读不到这两个参数，' +
					'奇数步长可能只抽到表图，那种图请把开关打开'
				)
			},

			// 直接把结论说出来，不让人去读数字
			diagnosisText() {
				if (this.mode === 'encode') {
					if (!this.resultSrc || !this.stats) return ''
					const stats = this.stats
					if (stats.separation < 10) {
						return (
							'诊断：里图和表图的亮度带只隔了 ' + stats.separation + ' 级，太窄 —— ' +
							'显形时会把表图的像素一起拉伸进来。把「表图色阶端」调大，或把「里图色阶端」调小'
						)
					}
					return ''
				}
				if (!this.decodedPreview || !this.decodeStats) return ''
				const stats = this.decodeStats
				if (stats.degenerate) {
					return '诊断：阈值上界必须大于下界，现在区间是空的，所以整张都成了黑色'
				}
				// 编码后表图的亮度恒在色阶端以外、不会被误抓，所以落带比例是个很灵敏的判据：
				// 阈值框对的时候，里图占比**精确等于** 1/(间隔+1)（间隔 1 就是标准棋盘格 50%）。
				// 显形这边不知道制作时用的间隔（元数据里不带这一位），所以对得上任何一个
				// 合理间隔就算正常，全都对不上才提示。
				const ratio = stats.innerRatio
				if (isPlausibleInnerRatio(ratio)) return ''
				// 这条如果出现，说明这个比例精确地落不到任何一个合理值上，基本可以断定
				// 阈值和这张图不匹配。按可能性从高到低给几条出路，别只丢一句"检查阈值"。
				//
				// **「被缩小过」必须排在最前面**（当前正在抽样时）：它是本页自己造成的、
				// 唯一一个一键能修的原因。这条踩过：原来的三条里没有它，用户照着②去点
				// 「从图本身自动检测阈值」，而反推在缩过的图上同样是错的，只会越走越偏。
				const causes = []
				const cache = this.decodeCache
				if (cache && cache.step > 1) {
					causes.push(
						'这张图被缩小过 —— 插值缩放会把棋盘格的亮度带糊掉。现在正按步长 ' + cache.step +
						' 抽样，把上面的「按原尺寸显形」开关打开重试'
					)
				}
				causes.push('这张图其实是反相的 —— 试试上面的「这张图是反相的」开关')
				causes.push('图像被整体调过亮度或重压过，已经和它自带的参数对不上了 —— 点「从图本身自动检测阈值」')
				causes.push('这张图根本不是光棱坦克')
				if (!cache || cache.step <= 1) {
					causes.push('这张图在到达本页之前就被别的工具缩小过 —— 插值缩放会糊掉亮度带，找没缩过的原图')
				}
				let list = ''
				for (let i = 0; i < causes.length; i++) {
					list += (i === 0 ? '' : '；') + ['①', '②', '③', '④', '⑤'][i] + ' ' + causes[i]
				}
				return (
					'诊断：落进阈值带的只有 ' + (ratio * 100).toFixed(1) + '%，对不上任何合理间隔该有的比例' +
					'（间隔 1~4 分别是 50% / 33% / 25% / 20%，框对的时候是精确相等的）。按可能性排查：' +
					list
				)
			}
		},
		methods: {
			methodLabel(value) {
				for (let i = 0; i < this.methodOptions.length; i++) {
					if (this.methodOptions[i].value === value) return this.methodOptions[i].label
				}
				return value
			},

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
					if (kind === 'cover') {
						this.coverImage = image
						this.encodeCache = null
						this.markDirty()
					} else if (kind === 'inner') {
						this.innerImage = image
						this.encodeCache = null
						this.markDirty()
					} else {
						this.prismImage = image
						this.decodeCache = null
						// 上一张图如果大到跳过了实时预览，这个标记会留着，得跟着一起清掉
						this.decodeLiveSkipped = false
						// 先看这张图有没有自带显形参数（参考实现和我们自己导出的图会写在 PNG 的
						// tEXt 块里），有就用它的，没有才用手上滑块的值
						await this.detectPreset(image)
						// 选完直接显形，省一次点击
						this.decodeImage()
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
				const cover = this.coverImage
				this.coverImage = this.innerImage
				this.innerImage = cover
				// 交换后里图变了，输出尺寸也跟着变（里图决定尺寸），缓存作废
				this.encodeCache = null
				this.markDirty()
			},

			// ---- 滑块拖动中（changing）：只出降分辨率预览，够看趋势就行 ----
			// 这一批的 value 是从 <tool-slider> 直接抛出来的数字，不再是原生事件对象；
			// 下面那些 <switch> 的 handler 仍然收 event.detail.value，别混
			onCoverThresholdChanging(value) {
				this.coverThreshold = value
				this.scheduleLive('encode')
			},

			onInnerThresholdChanging(value) {
				this.innerThreshold = value
				this.scheduleLive('encode')
			},

			onDecodeLowerChanging(value) {
				this.decodeLower = value
				this.scheduleLive('decode')
			},

			onDecodeHigherChanging(value) {
				this.decodeHigher = value
				this.scheduleLive('decode')
			},

			// ---- 松手（change）：用全分辨率重算一遍 ----
			onCoverThresholdChange(value) {
				this.coverThreshold = value
				this.markDirty()
				this.afterParamChange('encode')
			},

			onInnerThresholdChange(value) {
				this.innerThreshold = value
				this.markDirty()
				this.afterParamChange('encode')
			},

			onDecodeLowerChange(value) {
				this.decodeLower = value
				this.afterParamChange('decode')
			},

			onDecodeHigherChange(value) {
				this.decodeHigher = value
				this.afterParamChange('decode')
			},

			// 开关没有拖动过程，直接全分辨率重算
			onReverseChange(event) {
				this.isReverse = event.detail.value
				this.markDirty()
				this.afterParamChange('encode')
			},

			onCoverGrayChange(event) {
				this.coverGray = event.detail.value
				this.markDirty()
				this.afterParamChange('encode')
			},

			onInnerGrayChange(event) {
				this.innerGray = event.detail.value
				this.markDirty()
				this.afterParamChange('encode')
			},

			// ---- 对比度：拖动时实时预览，松手出全分辨率 ----
			onInnerContrastChanging(value) {
				this.innerContrast = value
				this.scheduleLive('encode')
			},

			onInnerContrastChange(value) {
				this.innerContrast = value
				this.markDirty()
				this.afterParamChange('encode')
			},

			onCoverContrastChanging(value) {
				this.coverContrast = value
				this.scheduleLive('encode')
			},

			onCoverContrastChange(value) {
				this.coverContrast = value
				this.markDirty()
				this.afterParamChange('encode')
			},

			resetContrast() {
				this.innerContrast = LIMITS.contrastDefault
				this.coverContrast = LIMITS.contrastDefault
				this.markDirty()
				this.afterParamChange('encode')
			},

			// ---- 交错参数：改的是铺法本身，必须重新编码 ----
			setRow(value) {
				if (this.isRow === value) return
				this.isRow = value
				this.markDirty()
				this.afterParamChange('encode')
			},

			onGapChanging(value) {
				this.gap = value
				this.scheduleLive('encode')
			},

			onGapChange(value) {
				this.gap = value
				this.markDirty()
				this.afterParamChange('encode')
			},

			onSlopeChanging(value) {
				this.slope = value
				this.scheduleLive('encode')
			},

			onSlopeChange(value) {
				this.slope = value
				this.markDirty()
				this.afterParamChange('encode')
			},

			// ---- 显形侧 ----
			onDecodeContrastChanging(value) {
				this.decodeContrast = value
				this.scheduleLive('decode')
			},

			onDecodeContrastChange(value) {
				this.decodeContrast = value
				this.afterParamChange('decode')
			},

			onDecodeIterationsChanging(value) {
				this.decodeIterations = value
				this.scheduleLive('decode')
			},

			onDecodeIterationsChange(value) {
				this.decodeIterations = value
				this.afterParamChange('decode')
			},

			onSharpenFillChange(event) {
				this.sharpenFill = event.detail.value
				this.afterParamChange('decode')
			},

			/**
			 * 切换「按原尺寸显形」。改的是读像素的尺寸，缓存必须整份作废重读 —— 照 setEdge 的写法。
			 * **但不要跟着 markDirty()**：那个标记是给制作侧的（切到制作 tab 会显示「参数改过了，
			 * 点生成刷新预览」），这里一个制作参数都没动。
			 */
			onDecodeNativeSizeChange(event) {
				const value = event.detail.value
				if (this.decodeNativeSize === value) return
				this.decodeNativeSize = value
				this.invalidateCaches()
				if (this.prismImage.path) this.decodeImage()
			},

			setEdge(value) {
				if (this.edge === value) return
				this.edge = value
				// 长边上限变了意味着目标尺寸变了，缓存的像素缓冲对应的是旧尺寸，必须作废
				this.invalidateCaches()
				this.markDirty()
			},

			setDecodeMethod(value) {
				if (this.decodeMethod === value) return
				this.decodeMethod = value
				// 显影方式只影响区间外的像素怎么填，不用重新读图
				this.afterParamChange(this.mode === 'decode' ? 'decode' : 'encode')
			},

			/**
			 * 由当前的制作参数推出「显形这张图时该用的那套参数」。
			 *
			 * 刻意**绕一圈预设**（encodePreset → decodePreset）而不是直接算阈值：走的是和
			 * 「从图片元数据读回」完全相同的那条路，所以这里的值和自己导出的图再读回来的值
			 * 永远一致 —— 包括对比度那个反向闭环，不用在第二个地方再推导一遍。
			 *
			 * 两个地方共用它：会话内预填（applyThresholdPrefill）、制作页的「模拟显形」预览
			 * （renderEncode）。预览曾经漏了对比度，结果预览比真实显形差一个量级
			 * （实测里图对比度 60 时：真实显形里图位 RMSE 0.82、预览 11.98）。
			 */
			decodeParamsForEncode() {
				const preset = decodePreset(encodePreset(this.isReverse, this.innerThreshold, this.innerContrast))
				// encodePreset 会把色阶端夹到 >= 1，正常解不出 null；真出了就退回默认区间，
				// 不让一个理论上到不了的分支把预览整个搞挂
				return preset || { lower: DECODE_LOWER_DEFAULT, higher: DECODE_HIGHER_DEFAULT, contrast: 0 }
			},

			/** 把制作的参数填进显形 tab 的滑块 —— 制作完立刻填好，省得两边对不上 */
			applyThresholdPrefill() {
				const preset = this.decodeParamsForEncode()
				this.decodeLower = preset.lower
				this.decodeHigher = preset.higher
				this.decodeContrast = preset.contrast
			},

			/**
			 * 从 PNG 的 tEXt 块里读显形参数。参考实现把制作参数写在那里，我们自己导出的图也写
			 * （见 renderEncode），所以选完图不用调阈值就能直接显形 —— 这是参考实现解决
			 * 「参数难调」的办法。刻意没有塞进 readPixels：读像素和读文件字节是两件事，
			 * 而且元数据失败不该影响显形。
			 *
			 * 读不到不算错误：别的工具做的图、被有损压过的图、平台抹掉元数据的图都读不到，
			 * 那就继续用手上滑块的阈值。整段异常也静默吞掉。
			 */
			async detectPreset(image) {
				this.presetInfo = ''
				this.presetApplied = false
				this.recoveredFromBadPreset = false
				this.decodeContrast = 0
				// **反相方向必须在每次选图时重置**，不能沿用上一张图的值。
				// 这里曾经只在"元数据解析成功"的分支里赋值，而读不到元数据时会提前 return，
				// 于是方向保留了上一张图（或用户手动拨过开关）的陈旧值 ——
				// 反推就会往反方向找，落带比例掉到 5% 上下（实测复现 5.0%，用户报的 5.8%）。
				// 默认跟制作页的反相开关走：如果这张图是刚在本会话里做的，那就是对的。
				this.decodeIsReverse = this.isReverse
				this.metadataRaw = ''
				this.metadataRange = null
				this.detectedRange = null
				// 读不到文件字节时保持 null（未知），别留上一张图的值
				this.prismIsPng = null
				try {
					const bytes = await readFileBytes(image.path)
					if (!bytes) return
					// 只有 PNG 能走纯 JS 精确解码，其它格式会退回 canvas。这条只用来决定
					// 提示怎么写、不影响读像素（那边自己会挑路）
					this.prismIsPng = isPng(bytes)
					const raw = readPngText(bytes)
					if (!raw) return
					this.metadataRaw = raw

					const preset = decodePreset(raw)
					if (!preset) {
						this.presetInfo = '这张图里有元数据「' + raw + '」但解析不出来，改从图本身反推阈值'
						return
					}

					this.decodeLower = preset.lower
					this.decodeHigher = preset.higher
					this.decodeContrast = preset.contrast
					this.decodeIsReverse = preset.isReverse
					this.presetApplied = true
					this.metadataRange = { lower: preset.lower, higher: preset.higher }
					this.presetInfo =
						'这张图自带显形参数（' + raw + '）：' +
						(preset.isReverse ? '反相' : '非反相') +
						'，阈值 ' + preset.lower + '~' + preset.higher +
						(preset.contrast !== 0 ? '，对比度 ' + preset.contrast : '')
				} catch (error) {
					// 元数据是锦上添花，读不到就算了 —— 后面会从图本身反推
					this.presetInfo = ''
				}
			},

			/**
			 * 从图本身反推显形阈值。元数据读不到时（别的工具做的图、被压过的图、
			 * 平台读不到文件的图）这是唯一能自动框对阈值的办法。
			 *
			 * 为什么必须要有这一步：阈值一旦没对上制作时的里图色阶端，里图里较亮的区域会
			 * 整片掉出亮度带、被当成表图丢去插值，显形结果里就出现一块一块的糊斑
			 * （实测掉带位锐度 0.28、正常位 3.25，成片出现，一眼可见）。
			 */
			applyDetectedRange() {
				const cache = this.decodeCache
				if (!cache) return false
				const range = detectDecodeRange(cache.pixels, this.decodeIsReverse)
				if (!range) return false
				this.decodeLower = range.lower
				this.decodeHigher = range.higher
				this.detectedRange = range
				return true
			},

			/**
			 * 反推结果拼成一句人能读的话。
			 * **只在调用方赋值、不在这里追加** —— 这个函数会被调用很多次（选图、手动检测、
			 * 拨反相开关、元数据失效后的自动重算），之前写成追加，提示叠了六遍没法读。
			 */
			detectedRangeText() {
				const range = this.detectedRange
				if (!range) return ''
				// 边界外侧的连续空档长度是个很有用的判据：无损的光棱坦克图，里图带和表图带
				// 之间必然留着一整段空档；一旦被有损压缩过，噪点会把它填掉。
				// 实测每像素 σ=1 级噪声就让它从 24 掉到 18，σ=8 时归零。
				const confidence = range.emptyRun >= 10
					? '带外侧有 ' + range.emptyRun + ' 级空档，间隔像是 ' + range.gap + '，看着是无损的'
					: range.emptyRun >= 4
						? '带外侧只剩 ' + range.emptyRun + ' 级空档，比正常值小很多，很可能被重新压缩过'
						: '带外侧几乎没有空档，这张图很可能被重新编码过 —— 选图时被系统转成 JPEG，或者传图时没按「原图 / 文件」发'
				return '阈值 ' + range.lower + '~' + range.higher + '，' + confidence
			},

			prefillFromEncode() {
				this.applyThresholdPrefill()
				// 这是用户主动按的、参数来自制作侧，比反推更可信，别再被反推覆盖
				this.presetApplied = true
				if (this.prismImage.path) this.decodeImage()
			},

			autoDetectRange() {
				if (!this.prismImage.path) {
					uni.showToast({ title: '先在显形页选一张图', icon: 'none' })
					return
				}
				if (!this.decodeCache) {
					uni.showToast({ title: '图还没读进来，稍后再试', icon: 'none' })
					return
				}
				if (this.applyDetectedRange()) {
					this.presetApplied = false
					this.presetInfo = '已从图本身反推：' + this.detectedRangeText()
					this.renderDecode(true)
				} else {
					uni.showToast({ title: '没能从这张图推出阈值', icon: 'none' })
				}
			},

			onDecodeReverseChange(event) {
				this.decodeIsReverse = event.detail.value
				// 方向变了就重新反推一次；还没读图就只是记下来
				if (this.decodeCache) this.autoDetectRange()
			},

			markDirty() {
				this.dirty = true
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

			// ---------------------------------------------------- 缓存与渲染
			//
			// 读像素是平台调用（慢），全分辨率 PNG 导出是 pako 压缩（也慢），拖动滑块时
			// 这两样都不能重来。所以：
			//   读像素 -> 按「图 + 尺寸设置」缓存一次（制作侧按长边上限，显形侧按原尺寸）
			//   拖动中 -> 只重跑纯逻辑，把结果降采样到 previewEdge 再导出（小图 pako 快得多）
			//   松手后 -> 用全分辨率重算一遍
			//
			// 缓存里的像素缓冲必须直接复用：它只是被 encode/decode 读，不会被改写。

			invalidateCaches() {
				this.encodeCache = null
				this.decodeCache = null
				this.livePendingKind = ''
			},

			// 里图决定输出尺寸和比例（对齐参考实现），表图按它居中裁剪
			async readEncodeCache() {
				const target = planSize(this.innerImage.width, this.innerImage.height, this.edge)
				await this.prepareCanvas(target.width, target.height)
				const inner = await readPixels(this.innerImage.path, target, this.innerImage, this)
				const cover = await readPixels(this.coverImage.path, target, this.coverImage, this)
				this.encodeCache = { edge: this.edge, cover, inner }
			},

			/**
			 * 显形缓存的键。像素缓冲按「这张图 + 用哪种尺寸读」缓存，任一变了一定要重建。
			 * 用键而不是直接比 this.edge：开关翻转时可能还有一轮读取在飞，它回来时会写进
			 * 一个按旧设置读出来的缓冲（同类坑踩过一次，见 detectPreset 里那段）。
			 */
			decodeKey() {
				return this.decodeNativeSize ? 'native' : 'e' + this.edge
			},

			/**
			 * 读显形用的像素。
			 *
			 * **永远按源图原尺寸读，不缩小。** 缩放在这里会毁掉棋盘格：readPixels 现在优先走
			 * 「从文件字节纯 JS 解 PNG」+ resizeCoverImage，而后者是双线性插值 —— 插值会把
			 * 相邻的表图像素（亮度 >= 表图色阶端）和里图像素（<= 里图色阶端）平均进两带之间的
			 * 空档，于是整片像素出带、被判成表图，显出来就剩噪点和透明洞。
			 * 实测（1440×960、t=24/T=42）：不缩放落带 50.0%；缩 0.1% 落带 9.8%；缩到 720×480
			 * 落带 10.1% —— 缩多少都一样废，不存在「轻微缩小还能用」。
			 *
			 * 要缩小只能用 sampleImageOddStep 的奇数步长整点抽样，而且**必须在读完像素之后做**，
			 * 不能把抽样后的尺寸当 target 传进来：那样 resizeCoverImage 会再插值一次，抽样白做；
			 * 而且 App 端 readPixelsApp 用旧版 canvas，它的像素尺寸跟着模板 canvas 的 CSS 走，
			 * CSS 又是 prepareCanvas(target) 设的 —— 两边必须是同一个尺寸，否则读到的是错像素。
			 */
			async readDecodeCache() {
				const source = this.prismImage
				const target = { width: source.width, height: source.height }
				await this.prepareCanvas(target.width, target.height)
				const read = await readPixels(source.path, target, source, this)
				const pixels = this.decodeNativeSize
					? { width: read.width, height: read.height, data: read.data, step: 1 }
					: sampleImageOddStep(read, this.edge)
				this.decodeCache = { key: this.decodeKey(), step: pixels.step, pixels }
			},

			/**
			 * 从缓存重跑编码，刷新两个预览。
			 *
			 * full=false 是拖动中的实时预览：模拟显形那张降采样后导出，够看趋势。
			 * 合成图外观不参与实时预览 —— 它是棋盘格，块平均降采样正好会把网格抹平，
			 * 显示的就不是真实观感了；所以它只在 full=true 那一轮刷新。
			 */
			async renderEncode(full) {
				const cache = this.encodeCache
				if (!cache || cache.edge !== this.edge) return
				const token = ++this.renderToken

				const encoded = encode({
					cover: cache.cover,
					inner: cache.inner,
					options: {
						coverThreshold: this.coverThreshold,
						innerThreshold: this.innerThreshold,
						isReverse: this.isReverse,
						coverGray: this.coverGray,
						innerGray: this.innerGray,
						innerContrast: this.innerContrast,
						coverContrast: this.coverContrast,
						slope: this.slope,
						gap: this.gap,
						isRow: this.isRow
					}
				})

				// 模拟显形的参数必须由当前制作参数推出来，不能读显形 tab 上的滑块值 ——
				// 那两个值可能还停在别的档位上，会算出一张不对应本次参数的预览。
				//
				// 走 decodeParamsForEncode（预设往返），所以**对比度那一格也是对的**：
				// 真实显形会从元数据读出 -innerContrast 把制作时提上去的对比度还原，
				// 这里不施加的话预览会明显发灰。实测（256px、里图对比度 60）：
				// 真实显形里图位 RMSE 0.82，不施加对比度的预览 11.98 —— 预览会劝用户去调
				// 本来就调对的参数，而对比度正是这条链上提升最明显的地方。
				const preset = this.decodeParamsForEncode()
				const revealed = decode({
					image: encoded,
					options: {
						lower: preset.lower,
						higher: preset.higher,
						contrast: preset.contrast,
						iterations: this.decodeIterations,
						method: this.decodeMethod,
						sharpenFill: this.sharpenFill
					}
				})

				const revealSource = full ? revealed : downsampleImage(revealed, this.previewEdge)
				const revealFlat = await exportPng(composite({ image: revealSource, background: 255 }))
				// 把显形参数写进 PNG 的 tEXt 块：别人（以及我们自己下次）拿到这张图就不用猜阈值了。
				// 只有全分辨率那一轮导出的那份是要保存/发出去的产物，所以只有它需要带元数据。
				// 存的是**里图的对比度**（表图的对比度不写，参考实现也只写这一个），
				// 显形时读出来会自动变成它的相反数施加回去，见 prismTank.js 的 encodePreset。
				const compositeExport = full
					? await exportPng(encoded, encodePreset(this.isReverse, this.innerThreshold, this.innerContrast))
					: null

				const commit = this.claimRender(token, [
					revealFlat.src,
					compositeExport ? compositeExport.src : null
				])
				if (!commit) return

				releaseImage(this.revealPreview)
				this.revealPreview = revealFlat.src
				this.stats = encoded.stats

				if (full) {
					releaseImage(this.resultSrc)
					this.resultSrc = compositeExport.src
					this.staleFull = false
				} else {
					// 这一轮只刷新了模拟显形，合成图外观和可保存的那份还是旧的
					this.staleFull = true
				}
			},

			async renderDecode(full) {
				const cache = this.decodeCache
				if (!cache || cache.key !== this.decodeKey()) return
				// 大图拖动时不跑实时预览：decode() 是同步的、跑在完整像素缓冲上，实测 24MP
				// 一帧 1415ms，会把主线程卡住让滑块拖不动（输入尺寸没法降级 —— decode 必须
				// 看到完整缓冲才能按亮度判带）。松手后的 full 那一轮照常算。
				if (!full && cache.pixels.width * cache.pixels.height > this.liveDecodeMaxPixels) {
					this.decodeLiveSkipped = true
					return
				}
				if (full) this.decodeLiveSkipped = false
				const token = ++this.renderToken

				const revealed = decode({
					image: cache.pixels,
					options: {
						lower: this.decodeLower,
						higher: this.decodeHigher,
						method: this.decodeMethod,
						contrast: this.decodeContrast,
						iterations: this.decodeIterations,
						sharpenFill: this.sharpenFill
					}
				})

				const flatSource = full ? revealed : downsampleImage(revealed, this.previewEdge)
				const flat = await exportPng(composite({ image: flatSource, background: 255 }))
				const rawExport = full ? await exportPng(revealed) : null

				const commit = this.claimRender(token, [flat.src, rawExport ? rawExport.src : null])
				if (!commit) return

				releaseImage(this.decodedPreview)
				this.decodedPreview = flat.src
				this.decodeStats = revealed.stats

				if (full) {
					releaseImage(this.decodedRaw)
					this.decodedRaw = rawExport.src
					this.staleFull = false
				} else {
					this.staleFull = true
				}
			},

			/**
			 * 领号之后才发现有更新的一轮在跑，说明这次的结果已经过期，要丢掉。
			 * 不这么做的话，拖动中的实时预览可能晚于松手后的全分辨率渲染落地，把好结果覆盖掉。
			 * 丢掉时把已经导出好的文件回收掉，不然 H5 的 blob 和 App/小程序的持久文件都会漏。
			 */
			claimRender(token, exportedSrcs) {
				if (token === this.renderToken) return true
				for (let i = 0; i < exportedSrcs.length; i++) releaseImage(exportedSrcs[i])
				return false
			},

			// change 事件每帧都来，而一次渲染要几十毫秒。合并成「最新一次优先」：
			// 渲染中再来就只记个标记，这一轮跑完补跑一次，中间的直接丢掉。
			scheduleLive(kind) {
				this.livePendingKind = kind
				if (this.liveBusy) return
				this.stepLive()
			},

			async stepLive() {
				this.liveBusy = true
				try {
					while (this.livePendingKind) {
						const kind = this.livePendingKind
						this.livePendingKind = ''
						try {
							if (kind === 'encode') await this.renderEncode(false)
							else await this.renderDecode(false)
						} catch (error) {
							// 实时预览失败不打断拖动也不弹错：松手后那一轮会正经报一次
							console.error('[prism-tank] 实时预览失败', error)
						}
					}
				} finally {
					this.liveBusy = false
				}
			},

			// 松手 / 开关变化：用全分辨率重算。还没有缓存（没生成过）就只标脏，等用户点按钮
			afterParamChange(kind) {
				const cache = kind === 'encode' ? this.encodeCache : this.decodeCache
				if (!cache) return
				// 两边的缓存键不一样：制作侧跟长边上限走，显形侧跟「按不按原尺寸」走
				if (kind === 'encode' ? cache.edge !== this.edge : cache.key !== this.decodeKey()) return
				this.livePendingKind = ''
				if (kind === 'encode') this.renderEncode(true)
				else this.renderDecode(true)
			},

			async generate() {
				if (!this.bothPicked) {
					uni.showToast({ title: '请先选择两张图片', icon: 'none' })
					return
				}
				if (!this.thresholdCheck.valid) {
					uni.showToast({ title: this.thresholdError, icon: 'none' })
					return
				}
				if (this.busy) return
				this.busy = true
				this.errorText = ''
				uni.showLoading({ title: '合成中...' })
				try {
					if (!this.encodeCache) await this.readEncodeCache()
					await this.renderEncode(true)
					// 制作完把显形 tab 的阈值也填好，省得两边对不上
					this.applyThresholdPrefill()
					this.dirty = false
					uni.hideLoading()
				} catch (error) {
					uni.hideLoading()
					this.fail('生成失败', error)
				}
				this.busy = false
			},

			async saveResult() {
				if (!this.resultSrc || this.busy || this.staleFull) return
				this.busy = true
				try {
					await savePng(this.resultSrc, 'prism-tank.png')
					uni.showToast({ title: '已保存' })
				} catch (error) {
					this.fail('保存失败', error)
				}
				this.busy = false
			},

			async decodeImage() {
				if (!this.prismImage.path || this.busy) return
				this.busy = true
				this.errorText = ''
				uni.showLoading({ title: '显形中...' })
				try {
					if (!this.decodeCache) await this.readDecodeCache()
					// 元数据没生效就从图本身反推阈值，别让用户拿着对不上的阈值去显形
					if (!this.presetApplied && this.applyDetectedRange()) {
						this.presetInfo = '这张图没有可用的元数据，已从图本身反推：' + this.detectedRangeText()
					}
					await this.renderDecode(true)

					// 元数据给的阈值对**未经改动的**图是精确的，而且亮度正确（反推只能估出
					// "里图最大亮度"，估不出制作时设的色阶端，用它会让画面偏亮），所以默认信任它。
					// 但落带比例对不上任何合理间隔，就说明这张图的像素和元数据已经对不上了
					//（被整体调过亮度、或重压过），此时元数据已经没有参考价值，改用从图反推。
					if (this.presetApplied && !this.recoveredFromBadPreset &&
						this.decodeStats && !isPlausibleInnerRatio(this.decodeStats.innerRatio)) {
						this.recoveredFromBadPreset = true
						if (this.applyDetectedRange()) {
							this.presetInfo = '图里自带的那套参数和这张图的像素对不上（落带比例只有 ' +
								(this.decodeStats.innerRatio * 100).toFixed(1) + '%），已经改用从图本身反推的：' +
								this.detectedRangeText()
							await this.renderDecode(true)
						}
					}
					uni.hideLoading()
				} catch (error) {
					uni.hideLoading()
					this.fail('显形失败', error)
				}
				this.busy = false
			},

			async saveDecoded() {
				if (!this.decodedRaw || this.busy || this.staleFull) return
				this.busy = true
				try {
					await savePng(this.decodedRaw, 'prism-decoded.png')
					uni.showToast({ title: '已保存' })
				} catch (error) {
					this.fail('保存失败', error)
				}
				this.busy = false
			},

			toggleDiag() {
				this.diagOpen = !this.diagOpen
				if (this.diagOpen) this.refreshDiag()
			},

			refreshDiag() {
				const info = getDiagnostics()
				const lines = [
					'平台：' + info.platform + '（' + info.system + '）',
					'canvas 节点：' + info.canvasNode,
					'最近读到的像素：' + info.readBytes + ' 字节',
					'alpha 抽样：' + info.alphaNonZero + '/' + info.alphaSamples + ' 个非零',
					'最近一次错误：' + (info.lastError || '无')
				]
				// 显形出问题时，下面这几行是最有用的：元数据说是什么、从像素里反推出什么、
				// 两者对不上就说明这张图的像素和它自带的参数已经不是一回事了
				if (this.prismImage.path) {
					lines.push('—— 这张图 ——')
					// 「读进来的是原生像素还是被缩过、缩到多少」是排查显形异常的第一手信息 ——
					// 缩放会把棋盘格的亮度带糊掉，而且从别的几项数字上完全看不出来
					lines.push('源文件类型：' + (this.prismIsPng === null
						? '未知（没读到文件字节）'
						: this.prismIsPng ? 'PNG（走纯 JS 精确解码）' : '不是 PNG（退回 canvas）'))
					const cache = this.decodeCache
					lines.push('读像素用的尺寸：' + (cache
						? cache.pixels.width + '×' + cache.pixels.height +
							(cache.step > 1
								? '（源图 ' + this.prismImage.width + '×' + this.prismImage.height +
									'，抽样步长 ' + cache.step + '）'
								: '（按原尺寸）')
						: '还没读'))
					lines.push('元数据原文：' + (this.metadataRaw ? '「' + this.metadataRaw + '」' : '（没读到 tEXt 块）'))
					lines.push('元数据给的阈值：' + (this.metadataRange
						? this.metadataRange.lower + '~' + this.metadataRange.higher
						: '无'))
					lines.push('从图反推的阈值：' + (this.detectedRange
						? this.detectedRange.lower + '~' + this.detectedRange.higher +
							'（带外侧空档 ' + this.detectedRange.emptyRun + ' 级，间隔像是 ' + this.detectedRange.gap + '）'
						: '没推出来'))
					lines.push('当前在用的阈值：' + this.decodeLower + '~' + this.decodeHigher +
						(this.decodeIsReverse ? '（反相）' : '（非反相）'))
					if (this.decodeStats) {
						lines.push('落带比例：' + (this.decodeStats.innerRatio * 100).toFixed(1) +
							'%（框对时应为 50% / 33% / 25% / 20% 之一）')
					}
				}
				this.diagLines = lines
			},

			fail(title, error, hint) {
				const message = (error && (error.message || error.errMsg)) || String(error)
				this.errorText = title + '：' + message + (hint ? '\n' + hint : '')
				noteError(title + '：' + message)
				if (this.diagOpen) this.refreshDiag()
				uni.showToast({ title: title, icon: 'none' })
				console.error('[prism-tank] ' + title, error)
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

	.inline-error {
		display: block;
		margin-top: 10rpx;
		font-size: 24rpx;
		line-height: 36rpx;
		color: #E8684A;
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

	/* 显影方式有 5 个选项，一行放不下，让它换行并且按内容定宽 */
	.pills-wrap {
		flex-wrap: wrap;
	}

	.pills-wrap .pill {
		flex: none;
		padding: 0 22rpx;
		margin-bottom: 12rpx;
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

	.preview-note {
		display: block;
		margin-top: 12rpx;
		font-size: 22rpx;
		line-height: 34rpx;
		color: #B6BAC3;
	}

	.stage {
		height: 480rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 20rpx;
		overflow: hidden;
	}

	.stage-plain {
		background-color: #FFFFFF;
		border: 2rpx solid #E6E8EE;
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

	.diagnosis {
		margin-bottom: 24rpx;
		padding: 24rpx 28rpx;
		background-color: #FFF7E6;
		border-radius: 16rpx;
	}

	.preset {
		margin-bottom: 24rpx;
		padding: 20rpx 24rpx;
		background-color: #E8F0FE;
		border-radius: 16rpx;
	}

	.preset-text {
		font-size: 24rpx;
		line-height: 36rpx;
		color: #5B8FF9;
	}

	.diagnosis-text {
		font-size: 26rpx;
		line-height: 40rpx;
		color: #8C5A12;
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
