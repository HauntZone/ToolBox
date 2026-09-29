/**
 * uqrcode.js 的 ESM 包装。
 *
 * common/uqrcode.js 是从 npm 取来的 UMD 单文件包：在浏览器原生 ESM（Vite/H5）下
 * 它既拿不到 module.exports，也不会产生 export default，而是把 UQRCode 挂到全局
 * 作用域上（globalThis.UQRCode）。所以这里先执行它，再把全局上的类重新导出，
 * 页面里就能正常 `import UQRCode from '@/common/uqrcode.esm.js'`。
 *
 * ESM 保证被 import 的模块先于本模块求值，所以下面的取值一定拿得到。
 * 这样做的好处是 uqrcode.js 可以保持与原包完全一致，方便日后升级。
 */

import './uqrcode.js'

function resolveGlobalScope() {
	if (typeof globalThis !== 'undefined') return globalThis
	if (typeof window !== 'undefined') return window
	if (typeof global !== 'undefined') return global
	return {}
}

const UQRCode = resolveGlobalScope().UQRCode

if (!UQRCode) {
	console.error('[uqrcode] 没有在全局作用域找到 UQRCode，请确认 common/uqrcode.js 已正确加载')
}

export default UQRCode
