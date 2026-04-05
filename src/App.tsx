import { useState, useMemo, useCallback } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  regionsData,
  generateYears,
  landUseClasses,
  scaleOptions,
  crsOptions,
  exportModeOptions
} from './data/regions';

const years = generateYears();

// ---- GeoTIFF minimal binary stub (valid TIFF header for real-looking files) ----
// A minimal GeoTIFF-like binary structure: TIFF little-endian header + placeholder pixel data
function buildTiffStub(fileName: string, regionInfo: string, year: number, scale: number, crs: string): Uint8Array {
  // Encode metadata as a comment block before the binary stub
  const meta = [
    `# CLCD Land Use Data`,
    `# File: ${fileName}`,
    `# Region: ${regionInfo}`,
    `# Year: ${year}`,
    `# Resolution: ${scale}m`,
    `# CRS: ${crs}`,
    `# Source: CLCD v01 (China Land Cover Dataset)`,
    `# Generated: ${new Date().toISOString()}`,
    `#`,
    `# Classification:`,
    `#  1=Cropland, 2=Forest, 3=Grassland, 4=Shrubland`,
    `#  5=Wetland, 6=Water, 7=Tundra, 8=Impervious`,
    `#  9=Bareland, 10=Snow/Ice`,
    `#`,
    `# NOTE: This is a metadata stub. In a real GEE environment,`,
    `# the actual GeoTIFF would be exported via Export.image.toDrive().`,
    `# To obtain real data, please run the GEE script in Google Earth Engine.`,
    ``,
  ].join('\n');

  const metaBytes = new TextEncoder().encode(meta);

  // Minimal TIFF little-endian header (II = 0x4949, magic = 42 = 0x002A)
  const tiffHeader = new Uint8Array([
    0x49, 0x49,       // Byte order: little-endian ("II")
    0x2A, 0x00,       // TIFF magic number 42
    0x08, 0x00, 0x00, 0x00  // Offset to first IFD
  ]);

  // Combine: text metadata + TIFF stub marker
  const combined = new Uint8Array(metaBytes.length + tiffHeader.length);
  combined.set(metaBytes, 0);
  combined.set(tiffHeader, metaBytes.length);
  return combined;
}

// Build a GEE script string for the user to run
function buildGEEScript(
  regionInfo: string,
  startYear: number,
  endYear: number,
  exportMode: string,
  scaleValue: number,
  crsCode: string,
  folderName: string,
  selectedProvince: string,
  selectedCity: string,
  selectedCounties: string[]
): string {
  const provinceName = selectedProvince.replace('省', '').replace('自治区', '').replace('市', '').replace('特别行政区', '');

  let roiCode = '';
  if (!selectedCity || selectedCity === '(全省)') {
    roiCode = `var roi = countyData.filter(ee.Filter.eq('省', '${selectedProvince}')).union().geometry();`;
  } else if (selectedCounties.length === 0) {
    roiCode = `var roi = countyData.filter(ee.Filter.eq('省', '${selectedProvince}')).filter(ee.Filter.eq('市', '${selectedCity}')).union().geometry();`;
  } else {
    roiCode = `var roi = countyData.filter(ee.Filter.eq('省', '${selectedProvince}')).filter(ee.Filter.eq('市', '${selectedCity}')).filter(ee.Filter.inList('县', ${JSON.stringify(selectedCounties)})).union().geometry();`;
  }

  const availableYears: number[] = [];
  for (let y = startYear; y <= endYear; y++) {
    if (y === 1985 || (y >= 1990 && y <= 2024)) availableYears.push(y);
  }

  let exportCode = '';
  if (exportMode === exportModeOptions[0]) {
    exportCode = `
// 整体导出（多波段）
var yearList = ${JSON.stringify(availableYears)};
var imageList = yearList.map(function(year) {
  return ee.Image('projects/lulc-datase/assets/LULC_HuangXin/CLCD_v01_' + year)
           .rename('CLCD_' + year);
});
var multiBand = ee.ImageCollection(imageList).toBands().clip(roi);
Export.image.toDrive({
  image: multiBand,
  description: 'CLCD_${startYear}_${endYear}_MultiBand',
  folder: '${folderName}',
  fileNamePrefix: 'CLCD_${startYear}_${endYear}_MultiBand',
  region: roi,
  scale: ${scaleValue},
  maxPixels: 1e13,
  crs: '${crsCode}'
});`;
  } else {
    exportCode = availableYears.map(year => `
Export.image.toDrive({
  image: ee.Image('projects/lulc-datase/assets/LULC_HuangXin/CLCD_v01_${year}').clip(roi),
  description: 'CLCD_${year}_${provinceName}',
  folder: '${folderName}',
  fileNamePrefix: 'CLCD_${year}',
  region: roi,
  scale: ${scaleValue},
  maxPixels: 1e13,
  crs: '${crsCode}'
});`).join('\n');
  }

  return `// =============================================
// CLCD土地利用数据批量下载 - GEE脚本
// =============================================
// 区域：${regionInfo}
// 年份：${startYear} 至 ${endYear}
// 导出模式：${exportMode}
// 分辨率：${scaleValue}m
// 坐标系：${crsCode}
// 文件夹：${folderName}
// 生成时间：${new Date().toISOString()}
// =============================================

var countyData = ee.FeatureCollection("projects/ee-xyt556/assets/China2024/county");

${roiCode}

// 可视化区域
Map.centerObject(roi, 8);
Map.addLayer(roi, {color: 'red'}, '研究区域');

// CLCD配色方案
var palette = [
  '#FFFF00', // 1-耕地
  '#008000', // 2-林地
  '#98FB98', // 3-草地
  '#90EE90', // 4-灌木
  '#00FFFF', // 5-湿地
  '#0000FF', // 6-水体
  '#ADFF2F', // 7-苔原
  '#FF0000', // 8-人造地表
  '#8B4513', // 9-裸地
  '#FFFFFF'  // 10-冰雪
];

// 预览第一年数据
var preview = ee.Image('projects/lulc-datase/assets/LULC_HuangXin/CLCD_v01_${startYear}').clip(roi);
Map.addLayer(preview, {min:1, max:10, palette: palette}, 'CLCD ${startYear}');

// =============================================
// 导出任务
// =============================================
${exportCode}

print('✅ 脚本运行完成，请前往Tasks面板点击Run启动导出任务');
`;
}

export function App() {
  const [selectedProvince, setSelectedProvince] = useState<string>('');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedCounties, setSelectedCounties] = useState<string[]>([]);
  const [startYear, setStartYear] = useState<string>('2020');
  const [endYear, setEndYear] = useState<string>('2024');
  const [exportMode, setExportMode] = useState<string>(exportModeOptions[1]);
  const [scale, setScale] = useState<string>('30米');
  const [crs, setCrs] = useState<string>('EPSG:4326');
  const [status, setStatus] = useState<string>('💡 请选择参数后点击预览');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error' | 'warning'>('info');
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadFiles, setDownloadFiles] = useState<{ name: string }[]>([]);
  const [showScriptModal, setShowScriptModal] = useState<boolean>(false);
  const [geeScript, setGeeScript] = useState<string>('');
  const [copiedScript, setCopiedScript] = useState<boolean>(false);

  const cities = useMemo(() => {
    if (!selectedProvince) return [];
    const province = regionsData.find(p => p.province === selectedProvince);
    return province?.cities.map(c => c.name) || [];
  }, [selectedProvince]);

  const counties = useMemo(() => {
    if (!selectedProvince || !selectedCity || selectedCity === '(全省)') return [];
    const province = regionsData.find(p => p.province === selectedProvince);
    const city = province?.cities.find(c => c.name === selectedCity);
    return city?.counties || [];
  }, [selectedProvince, selectedCity]);

  const handleProvinceChange = (province: string) => {
    setSelectedProvince(province);
    setSelectedCity('');
    setSelectedCounties([]);
    setIsPreviewMode(false);
    setDownloadFiles([]);
  };

  const handleCityChange = (city: string) => {
    setSelectedCity(city);
    setSelectedCounties([]);
    setIsPreviewMode(false);
    setDownloadFiles([]);
  };

  const handleCountyToggle = (county: string) => {
    setSelectedCounties(prev =>
      prev.includes(county) ? prev.filter(c => c !== county) : [...prev, county]
    );
    setIsPreviewMode(false);
    setDownloadFiles([]);
  };

  const selectAllCounties = () => setSelectedCounties([...counties]);
  const unselectAllCounties = () => setSelectedCounties([]);

  const getRegionInfo = useCallback(() => {
    if (!selectedProvince) return '';
    let info = selectedProvince;
    if (!selectedCity || selectedCity === '(全省)') {
      info += ' - 全省';
    } else if (selectedCounties.length === 0) {
      info += ' - ' + selectedCity + ' - 全市';
    } else {
      info += ' - ' + selectedCity + ' - ' + selectedCounties.slice(0, 3).join('、');
      if (selectedCounties.length > 3) info += '等' + selectedCounties.length + '个区县';
    }
    return info;
  }, [selectedProvince, selectedCity, selectedCounties]);

  const getScaleValue = (s: string) =>
    ({ '30米': 30, '100米': 100, '250米': 250, '500米': 500, '1000米': 1000 }[s] ?? 30);

  const isYearAvailable = (y: number) => y === 1985 || (y >= 1990 && y <= 2024);

  const getAvailableYears = useCallback(() => {
    const result: number[] = [];
    for (let y = parseInt(startYear); y <= parseInt(endYear); y++) {
      if (isYearAvailable(y)) result.push(y);
    }
    return result;
  }, [startYear, endYear]);

  const getTaskCount = useCallback(() => {
    if (exportMode === exportModeOptions[0]) return 1;
    return getAvailableYears().length;
  }, [exportMode, getAvailableYears]);

  const getFolderName = useCallback(() => {
    let name = 'CLCD_';
    if (selectedProvince) {
      name += selectedProvince
        .replace('省', '').replace('自治区', '').replace('市', '').replace('特别行政区', '');
    }
    if (selectedCity && selectedCity !== '(全省)') {
      name += '_' + selectedCity.replace('市', '').replace('自治州', '').replace('地区', '');
    }
    name += '_' + startYear + '_' + endYear;
    return name;
  }, [selectedProvince, selectedCity, startYear, endYear]);

  const handlePreview = () => {
    if (!selectedProvince) {
      setStatus('❌ 错误：请选择省份！');
      setStatusType('error');
      return;
    }
    const s = parseInt(startYear), e = parseInt(endYear);
    if (s > e) {
      setStatus('❌ 错误：起始年份不能大于结束年份！');
      setStatusType('error');
      return;
    }
    setIsPreviewMode(true);
    setDownloadFiles([]);
    const taskCount = getTaskCount();
    setStatus(
      `✅ 预览成功！\n` +
      `📍 区域：${getRegionInfo()}\n` +
      `📅 年份：${startYear} 至 ${endYear}\n` +
      `📦 导出模式：${exportMode}\n` +
      `📐 分辨率：${scale}\n` +
      `📁 文件夹：${getFolderName()}\n` +
      `🌐 坐标系：${crs}\n` +
      `📊 将生成 ${taskCount} 个文件\n` +
      `💡 点击下方"打包下载"按钮开始导出`
    );
    setStatusType('success');
  };

  // 核心下载逻辑：用 JSZip 打包所有文件为一个 ZIP 下载
  const handleDownload = async () => {
    if (!isPreviewMode) {
      setStatus('⚠️ 请先点击"预览数据"按钮！');
      setStatusType('warning');
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    setStatus('⏳ 正在打包文件，请稍候...');
    setStatusType('info');

    const folderName = getFolderName();
    const regionInfo = getRegionInfo();
    const scaleValue = getScaleValue(scale);
    const availableYears = getAvailableYears();
    const zip = new JSZip();
    const folder = zip.folder(folderName)!;
    const fileList: { name: string }[] = [];

    if (exportMode === exportModeOptions[0]) {
      // 整体导出：一个多波段元数据文件 + GEE脚本
      const fileName = `CLCD_${startYear}_${endYear}_MultiBand.tif`;
      const stub = buildTiffStub(fileName, regionInfo, parseInt(startYear), scaleValue, crs);
      folder.file(fileName, stub);
      fileList.push({ name: fileName });
      setDownloadProgress(50);
      await new Promise(r => setTimeout(r, 100));
    } else {
      // 按年导出：每年一个文件
      for (let i = 0; i < availableYears.length; i++) {
        const year = availableYears[i];
        const fileName = `CLCD_${year}.tif`;
        const stub = buildTiffStub(fileName, regionInfo, year, scaleValue, crs);
        folder.file(fileName, stub);
        fileList.push({ name: fileName });
        setDownloadProgress(Math.round(((i + 1) / availableYears.length) * 80));
        await new Promise(r => setTimeout(r, 30));
      }
    }

    // 把 GEE 脚本也放进 ZIP
    const script = buildGEEScript(
      regionInfo, parseInt(startYear), parseInt(endYear),
      exportMode, scaleValue, crs, folderName,
      selectedProvince, selectedCity, selectedCounties
    );
    folder.file('GEE_Download_Script.js', script);
    folder.file('README.txt',
      `CLCD土地利用数据打包说明\n` +
      `============================\n` +
      `区域：${regionInfo}\n` +
      `年份：${startYear} 至 ${endYear}\n` +
      `导出模式：${exportMode}\n` +
      `分辨率：${scaleValue}m\n` +
      `坐标系：${crs}\n` +
      `文件数量：${fileList.length} 个\n` +
      `打包时间：${new Date().toLocaleString()}\n\n` +
      `文件说明：\n` +
      `• .tif 文件为数据占位文件（含元数据头信息）\n` +
      `• 真实 GeoTIFF 数据需通过 Google Earth Engine 导出\n` +
      `• GEE_Download_Script.js 是可直接复制到 GEE 代码编辑器运行的脚本\n\n` +
      `如何获取真实数据：\n` +
      `1. 打开 https://code.earthengine.google.com/\n` +
      `2. 将 GEE_Download_Script.js 内容粘贴到编辑器\n` +
      `3. 点击 Run 运行脚本\n` +
      `4. 前往 Tasks 面板点击各任务的 Run 按钮\n` +
      `5. 文件将保存到您的 Google Drive / ${folderName} 文件夹\n`
    );

    setDownloadProgress(95);
    await new Promise(r => setTimeout(r, 100));

    // 生成 ZIP 并触发下载
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    saveAs(blob, `${folderName}.zip`);

    setDownloadProgress(100);
    setDownloadFiles(fileList);
    setIsDownloading(false);

    setStatus(
      `🎉 ZIP打包下载成功！\n` +
      `📍 区域：${regionInfo}\n` +
      `📅 年份：${startYear} 至 ${endYear}\n` +
      `📦 共打包 ${fileList.length} 个数据文件\n` +
      `📁 ZIP文件名：${folderName}.zip\n` +
      `📜 已含 GEE 脚本，可直接在 GEE 中运行获取真实数据`
    );
    setStatusType('success');
  };

  // 单独下载 GEE 脚本
  const handleDownloadScript = () => {
    if (!selectedProvince) {
      setStatus('⚠️ 请先选择省份！');
      setStatusType('warning');
      return;
    }
    const script = buildGEEScript(
      getRegionInfo(), parseInt(startYear), parseInt(endYear),
      exportMode, getScaleValue(scale), crs, getFolderName(),
      selectedProvince, selectedCity, selectedCounties
    );
    setGeeScript(script);
    setShowScriptModal(true);
  };

  const handleCopyScript = () => {
    navigator.clipboard.writeText(geeScript).then(() => {
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2000);
    });
  };

  const handleDownloadScriptFile = () => {
    const blob = new Blob([geeScript], { type: 'text/javascript;charset=utf-8' });
    saveAs(blob, `GEE_CLCD_Script_${getFolderName()}.js`);
  };

  const handleReset = () => {
    setSelectedProvince('');
    setSelectedCity('');
    setSelectedCounties([]);
    setStartYear('2020');
    setEndYear('2024');
    setExportMode(exportModeOptions[1]);
    setScale('30米');
    setCrs('EPSG:4326');
    setStatus('💡 请选择参数后点击预览');
    setStatusType('info');
    setIsPreviewMode(false);
    setDownloadFiles([]);
    setShowScriptModal(false);
  };

  const statusColors = {
    success: 'bg-green-50 text-green-700 border-green-200',
    error: 'bg-red-50 text-red-700 border-red-200',
    warning: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    info: 'bg-gray-50 text-gray-600 border-gray-200',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex">

      {/* ===== 左侧控制面板 ===== */}
      <div className="w-[400px] min-w-[400px] bg-white shadow-xl border-r border-gray-200 overflow-y-auto max-h-screen flex flex-col">
        <div className="p-5 flex-1">

          {/* 标题 */}
          <h1 className="text-xl font-bold text-blue-600 mb-1 flex items-center gap-2">
            🏞️ CLCD土地利用数据批量下载
          </h1>
          <p className="text-xs text-gray-400 mb-4">China Land Cover Dataset · 1985 &amp; 1990–2024</p>

          <div className="h-px bg-gray-200 mb-4" />

          {/* 区域选择 */}
          <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1">
            📍 选择研究区域
          </h2>

          <label className="block text-xs text-gray-500 mb-1">省份 <span className="text-red-500">*</span></label>
          <select
            className="w-full p-2 text-sm border border-gray-300 rounded-lg mb-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={selectedProvince}
            onChange={e => handleProvinceChange(e.target.value)}
          >
            <option value="">请选择省份...</option>
            {regionsData.map(p => (
              <option key={p.province} value={p.province}>{p.province}</option>
            ))}
          </select>

          <label className="block text-xs text-gray-500 mb-1">城市（可选，不选则下载全省）</label>
          <select
            className="w-full p-2 text-sm border border-gray-300 rounded-lg mb-3 focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
            value={selectedCity}
            onChange={e => handleCityChange(e.target.value)}
            disabled={!selectedProvince}
          >
            <option value="">{selectedProvince ? '留空 = 全省' : '请先选择省份'}</option>
            <option value="(全省)">(全省)</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <label className="block text-xs text-gray-500 mb-1">区县（可选，不选则下载全市）</label>
          {counties.length > 0 && (
            <div className="flex gap-2 mb-1">
              <button onClick={selectAllCounties} className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition">✅ 全选</button>
              <button onClick={unselectAllCounties} className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition">🚫 全不选</button>
              <span className="text-xs text-gray-400 self-center">已选 {selectedCounties.length}/{counties.length}</span>
            </div>
          )}
          <div className="border border-gray-200 rounded-lg p-2 max-h-36 overflow-y-auto bg-gray-50 mb-4">
            {!selectedProvince && <p className="text-gray-400 text-xs">请先选择省份</p>}
            {selectedProvince && (!selectedCity || selectedCity === '(全省)') && (
              <p className="text-gray-400 text-xs">已选全省，无需选择区县</p>
            )}
            {selectedCity && selectedCity !== '(全省)' && counties.length === 0 && (
              <p className="text-gray-400 text-xs">无可用区县数据</p>
            )}
            {counties.length > 0 && (
              <div className="space-y-0.5">
                {counties.map(county => (
                  <label key={county} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1 rounded transition">
                    <input
                      type="checkbox"
                      checked={selectedCounties.includes(county)}
                      onChange={() => handleCountyToggle(county)}
                      className="rounded text-blue-600 w-3 h-3"
                    />
                    <span className="text-xs text-gray-700">{county}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="h-px bg-gray-200 mb-4" />

          {/* 年份和导出设置 */}
          <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1">
            📅 年份与导出设置
          </h2>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">起始年份</label>
              <select className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                value={startYear} onChange={e => { setStartYear(e.target.value); setIsPreviewMode(false); }}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">结束年份</label>
              <select className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                value={endYear} onChange={e => { setEndYear(e.target.value); setIsPreviewMode(false); }}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          <label className="block text-xs text-gray-500 mb-1">导出模式</label>
          <select className="w-full p-2 text-sm border border-gray-300 rounded-lg mb-3 focus:ring-2 focus:ring-blue-500"
            value={exportMode} onChange={e => { setExportMode(e.target.value); setIsPreviewMode(false); }}>
            {exportModeOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">导出分辨率</label>
              <select className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                value={scale} onChange={e => { setScale(e.target.value); setIsPreviewMode(false); }}>
                {scaleOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">坐标系</label>
              <select className="w-full p-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                value={crs} onChange={e => { setCrs(e.target.value); setIsPreviewMode(false); }}>
                {crsOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="h-px bg-gray-200 mb-4" />

          {/* 分类说明 */}
          <h2 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1">🏷️ 土地利用分类</h2>
          <div className="grid grid-cols-2 gap-1 mb-4">
            {landUseClasses.map(cls => (
              <div key={cls.value} className="flex items-center gap-1.5 text-xs text-gray-600 p-0.5">
                <div className="w-3.5 h-3.5 rounded-sm border border-gray-300 flex-shrink-0" style={{ backgroundColor: cls.color }} />
                <span>{cls.value}-{cls.name}</span>
              </div>
            ))}
          </div>

          <div className="h-px bg-gray-200 mb-4" />

          {/* 操作按钮 */}
          <div className="space-y-2 mb-4">
            <div className="flex gap-2">
              <button onClick={handlePreview}
                className="flex-1 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition font-medium">
                🔍 预览数据
              </button>
              <button onClick={handleReset}
                className="flex-1 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium">
                🔄 重置
              </button>
            </div>

            {/* 主下载按钮 */}
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="w-full py-3 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 active:bg-green-800 transition font-bold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
            >
              {isDownloading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  打包中 {downloadProgress}%
                </>
              ) : (
                <>📦 打包下载 ZIP（含全部文件）</>
              )}
            </button>

            {/* 进度条 */}
            {isDownloading && (
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-green-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            )}

            {/* GEE 脚本按钮 */}
            <button
              onClick={handleDownloadScript}
              className="w-full py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition font-medium flex items-center justify-center gap-2"
            >
              📜 获取 GEE 下载脚本
            </button>
          </div>

          {/* 状态显示 */}
          <div className={`p-3 rounded-lg text-xs whitespace-pre-wrap border ${statusColors[statusType]}`}>
            {status}
          </div>
        </div>
      </div>

      {/* ===== 右侧主区域 ===== */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

          {/* 区域预览 */}
          <div className="bg-white rounded-xl shadow-md p-4">
            <h3 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">🗺️ 区域预览</h3>
            <div className="bg-gradient-to-br from-green-100 via-yellow-50 to-blue-100 rounded-lg h-72 flex items-center justify-center border-2 border-dashed border-gray-300 relative overflow-hidden">
              {isPreviewMode ? (
                <div className="text-center p-4 w-full">
                  <div className="text-3xl mb-2">🎯</div>
                  <div className="text-base font-bold text-gray-700">{getRegionInfo()}</div>
                  <div className="text-xs text-gray-500 mt-1">{startYear} – {endYear} · {scale} · {crs}</div>
                  <div className="mt-4 mx-auto max-w-xs">
                    <div className="flex rounded overflow-hidden h-6 shadow">
                      {landUseClasses.map(cls => (
                        <div key={cls.value} className="flex-1" style={{ backgroundColor: cls.color }} title={cls.name} />
                      ))}
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 mt-1 px-1">
                      <span>耕地</span><span>林地</span><span>草地</span><span>水体</span><span>冰雪</span>
                    </div>
                  </div>
                  <div className="mt-3 inline-block bg-white/80 rounded-lg px-3 py-1 text-xs text-green-700 font-medium">
                    ✅ {getTaskCount()} 个文件待下载
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-400">
                  <div className="text-5xl mb-3">🌍</div>
                  <p className="text-sm">选择区域后点击"预览数据"</p>
                </div>
              )}
            </div>
          </div>

          {/* 使用说明 */}
          <div className="bg-white rounded-xl shadow-md p-4">
            <h3 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">📖 使用说明</h3>
            <div className="text-xs text-gray-600 space-y-2">
              <div className="space-y-1">
                <p className="font-semibold text-gray-700">操作步骤：</p>
                <ol className="list-decimal list-inside space-y-0.5 ml-1">
                  <li>选择省份（必须）</li>
                  <li>选择城市（可选，留空=全省）</li>
                  <li>勾选区县（可选，留空=全市）</li>
                  <li>设置年份范围、模式、分辨率、坐标系</li>
                  <li>点击"预览数据"确认配置</li>
                  <li className="text-green-700 font-semibold">点击"打包下载 ZIP"→ 直接下载到本地</li>
                  <li className="text-orange-600">或点击"获取 GEE 脚本"→ 在 GEE 中导出到 Drive</li>
                </ol>
              </div>
              <div className="mt-2 p-2 bg-green-50 rounded-lg border border-green-200">
                <p className="font-semibold text-green-700">📦 ZIP 包含内容：</p>
                <ul className="mt-1 space-y-0.5 ml-1">
                  <li>• <code className="bg-white px-1 rounded">.tif</code> 数据占位文件（含元数据头）</li>
                  <li>• <code className="bg-white px-1 rounded">GEE_Download_Script.js</code> 可运行脚本</li>
                  <li>• <code className="bg-white px-1 rounded">README.txt</code> 说明文档</li>
                </ul>
              </div>
              <div className="p-2 bg-blue-50 rounded-lg border border-blue-200">
                <p className="font-semibold text-blue-700">💡 智能选择规则：</p>
                <ul className="mt-1 space-y-0.5 ml-1">
                  <li>• 只选省份 → 下载全省</li>
                  <li>• 省份 + 城市 → 下载全市</li>
                  <li>• 省份 + 城市 + 区县 → 下载指定区县</li>
                </ul>
              </div>
              <div className="p-2 bg-gray-50 rounded-lg border border-gray-200">
                <p className="font-semibold text-gray-700">📌 CLCD 数据说明：</p>
                <ul className="mt-1 space-y-0.5 ml-1">
                  <li>• 数据源：CLCD v01（黄翔等）</li>
                  <li>• 分辨率：30m · 分类：10类</li>
                  <li>• 时段：1985年 &amp; 1990–2024年</li>
                  <li>• 注：1986–1989年数据不可用</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* 已打包文件列表 */}
        {downloadFiles.length > 0 && (
          <div className="bg-white rounded-xl shadow-md p-4 mb-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                ✅ 已下载文件列表
                <span className="text-sm font-normal text-gray-500">（{downloadFiles.length} 个数据文件）</span>
              </h3>
              <button
                onClick={handleDownload}
                disabled={isDownloading}
                className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium disabled:opacity-50"
              >
                🔁 重新打包下载
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {downloadFiles.map((file, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center p-2 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition group"
                >
                  <div className="text-2xl mb-1">🗂️</div>
                  <span className="text-xs text-gray-600 text-center truncate w-full text-center group-hover:text-blue-700">{file.name}</span>
                </div>
              ))}
              {/* 额外显示脚本文件 */}
              <div className="flex flex-col items-center p-2 bg-orange-50 rounded-lg border border-orange-200">
                <div className="text-2xl mb-1">📜</div>
                <span className="text-xs text-orange-600 text-center">GEE_Script.js</span>
              </div>
              <div className="flex flex-col items-center p-2 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-2xl mb-1">📄</div>
                <span className="text-xs text-blue-600 text-center">README.txt</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              💡 所有文件已打包为 <strong>{getFolderName()}.zip</strong>，已自动下载到您的浏览器。
              真实 GeoTIFF 数据请使用包内的 GEE 脚本在 Google Earth Engine 中导出。
            </p>
          </div>
        )}

        {/* 年份可用性 */}
        <div className="bg-white rounded-xl shadow-md p-4">
          <h3 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">📊 数据年份可用性</h3>
          <div className="flex flex-wrap gap-1.5">
            {years.map(year => {
              const y = parseInt(year);
              const inRange = y >= parseInt(startYear) && y <= parseInt(endYear);
              return (
                <div
                  key={year}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                    inRange
                      ? 'bg-green-100 text-green-700 border-2 border-green-500 shadow-sm'
                      : 'bg-gray-100 text-gray-500 border border-gray-200'
                  }`}
                >
                  {year}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-2">绿色 = 当前选择范围 · 注意：1986–1989年数据不可用</p>
        </div>
      </div>

      {/* ===== GEE 脚本弹窗 ===== */}
      {showScriptModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-bold text-gray-800">📜 Google Earth Engine 下载脚本</h3>
                <p className="text-xs text-gray-500 mt-0.5">将此脚本粘贴到 GEE 代码编辑器中运行，即可导出真实 GeoTIFF 数据</p>
              </div>
              <button onClick={() => setShowScriptModal(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-4">×</button>
            </div>

            {/* 脚本内容 */}
            <div className="flex-1 overflow-auto p-4">
              <pre className="bg-gray-900 text-green-300 text-xs p-4 rounded-xl overflow-auto leading-relaxed font-mono whitespace-pre-wrap break-words">
                {geeScript}
              </pre>
            </div>

            {/* 弹窗底部按钮 */}
            <div className="p-4 border-t border-gray-200 flex gap-3">
              <button
                onClick={handleCopyScript}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition ${
                  copiedScript
                    ? 'bg-green-500 text-white'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {copiedScript ? '✅ 已复制！' : '📋 复制脚本'}
              </button>
              <button
                onClick={handleDownloadScriptFile}
                className="flex-1 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 transition"
              >
                ⬇️ 下载 .js 文件
              </button>
              <a
                href="https://code.earthengine.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 bg-gray-700 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition text-center"
              >
                🌐 打开 GEE 编辑器
              </a>
              <button
                onClick={() => setShowScriptModal(false)}
                className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-300 transition"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
