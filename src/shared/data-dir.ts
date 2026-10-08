// 数据目录解析（纯逻辑，可单测）
//
// 背景：安装包本身不含任何用户数据，但开发版与正式版过去共用
// %APPDATA%\GameTranslator，导致「用开发机打包装出来的正式版」会直接读到
// 开发时写下的模型配置 / API Key，看起来像"安装包自带了我的设置"。
// 因此这里把两种运行态的数据目录彻底隔离，并给开发态目录打标记：
// 正式版一旦发现目录被打过开发态标记，就把它清空为空白默认设置。

export const PACKAGED_DATA_DIR = 'GameTranslator'
export const DEV_DATA_DIR = 'GameTranslator-dev'

// 开发态数据目录里的标记文件（正式版据此判断目录被开发版污染过）
export const DEV_MARKER_FILE = '.dev-build'

export function resolveDataDirName(isPackaged: boolean): string {
  return isPackaged ? PACKAGED_DATA_DIR : DEV_DATA_DIR
}

// 正式版 + 目录来自开发版 => 需要清空成默认设置
export function shouldResetForCleanInstall(isPackaged: boolean, hasDevMarker: boolean): boolean {
  return isPackaged && hasDevMarker
}
