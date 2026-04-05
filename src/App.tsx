import { useState, useMemo, useCallback } from 'react';
import { 
  regionsData, 
  generateYears, 
  landUseClasses, 
  scaleOptions, 
  crsOptions, 
  exportModeOptions 
} from './data/regions';

const years = generateYears();

export function App() {
  // 状态管理
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
  const [downloadLinks, setDownloadLinks] = useState<{ name: string; url: string }[]>([]);
  const [showDownloadModal, setShowDownloadModal] = useState<boolean>(false);

  // 获取城市列表
  const cities = useMemo(() => {
    if (!selectedProvince) return [];
    const province = regionsData.find(p => p.province === selectedProvince);
    return province?.cities.map(c => c.name) || [];
  }, [selectedProvince]);

  // 获取区县列表
  const counties = useMemo(() => {
    if (!selectedProvince || !selectedCity || selectedCity === '(全省)') return [];
    const province = regionsData.find(p => p.province === selectedProvince);
    const city = province?.cities.find(c => c.name === selectedCity);
    return city?.counties || [];
  }, [selectedProvince, selectedCity]);

  // 处理省份变化
  const handleProvinceChange = (province: string) => {
    setSelectedProvince(province);
    setSelectedCity('');
    setSelectedCounties([]);
    setIsPreviewMode(false);
    setDownloadLinks([]);
  };

  // 处理城市变化
  const handleCityChange = (city: string) => {
    setSelectedCity(city);
    setSelectedCounties([]);
    setIsPreviewMode(false);
    setDownloadLinks([]);
  };

  // 处理区县选择
  const handleCountyToggle = (county: string) => {
    setSelectedCounties(prev => 
      prev.includes(county) 
        ? prev.filter(c => c !== county)
        : [...prev, county]
    );
    setIsPreviewMode(false);
    setDownloadLinks([]);
  };

  // 全选区县
  const selectAllCounties = () => {
    setSelectedCounties([...counties]);
  };

  // 取消全选
  const unselectAllCounties = () => {
    setSelectedCounties([]);
  };

  // 获取区域描述
  const getRegionInfo = useCallback(() => {
    if (!selectedProvince) return '';
    let info = selectedProvince;
    if (!selectedCity || selectedCity === '(全省)') {
      info += ' - 全省';
    } else if (selectedCounties.length === 0) {
      info += ' - ' + selectedCity + ' - 全市';
    } else {
      info += ' - ' + selectedCity + ' - ' + selectedCounties.slice(0, 3).join('、');
      if (selectedCounties.length > 3) {
        info += '等' + selectedCounties.length + '个区县';
      }
    }
    return info;
  }, [selectedProvince, selectedCity, selectedCounties]);

  // 计算任务数量
  const getTaskCount = useCallback(() => {
    if (exportMode === exportModeOptions[0]) return 1;
    let count = 0;
    const start = parseInt(startYear);
    const end = parseInt(endYear);
    for (let year = start; year <= end; year++) {
      if (year === 1985 || (year >= 1990 && year <= 2024)) {
        count++;
      }
    }
    return count;
  }, [startYear, endYear, exportMode]);

  // 生成文件夹名称
  const getFolderName = useCallback(() => {
    let name = 'CLCD_';
    if (selectedProvince) {
      name += selectedProvince.replace('省', '').replace('自治区', '').replace('市', '').replace('特别行政区', '');
    }
    if (selectedCity && selectedCity !== '(全省)') {
      name += '_' + selectedCity.replace('市', '').replace('自治州', '').replace('地区', '');
    }
    name += '_' + startYear + '_' + endYear;
    return name;
  }, [selectedProvince, selectedCity, startYear, endYear]);

  // 预览数据
  const handlePreview = () => {
    if (!selectedProvince) {
      setStatus('❌ 错误：请选择省份！');
      setStatusType('error');
      return;
    }

    const start = parseInt(startYear);
    const end = parseInt(endYear);
    if (start > end) {
      setStatus('❌ 错误：起始年份不能大于结束年份！');
      setStatusType('error');
      return;
    }

    setIsPreviewMode(true);
    setDownloadLinks([]);
    setStatus(
      `✅ 预览成功！\n` +
      `📍 区域：${getRegionInfo()}\n` +
      `📅 年份：${startYear} 至 ${endYear}\n` +
      `📦 导出模式：${exportMode}\n` +
      `🏷️ 分类系统：CLCD原始分类\n` +
      `📐 分辨率：${scale}\n` +
      `📁 文件夹：${getFolderName()}\n` +
      `🌐 坐标系：${crs}\n` +
      `📊 将生成 ${getTaskCount()} 个文件\n` +
      `💡 点击下方"立即下载"按钮开始导出`
    );
    setStatusType('success');
  };

  // 生成模拟下载数据
  const generateMockDownloadData = () => {
    const links: { name: string; url: string }[] = [];
    const start = parseInt(startYear);
    const end = parseInt(endYear);
    const folderName = getFolderName();

    if (exportMode === exportModeOptions[0]) {
      // 整体导出
      const fileName = `CLCD_${start}_${end}_MultiBand.tif`;
      links.push({ name: fileName, url: '#' });
    } else {
      // 按年导出
      for (let year = start; year <= end; year++) {
        if (year === 1985 || (year >= 1990 && year <= 2024)) {
          const fileName = `CLCD_${year}.tif`;
          links.push({ name: fileName, url: '#' });
        }
      }
    }

    return { links, folderName };
  };

  // 下载数据 - 模拟生成下载链接
  const handleDownload = async () => {
    if (!isPreviewMode) {
      setStatus('⚠️ 请先点击"预览数据"按钮！');
      setStatusType('warning');
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    setStatus('⏳ 正在准备下载任务...');
    setStatusType('info');

    // 模拟下载准备过程
    const { links, folderName } = generateMockDownloadData();
    
    for (let i = 0; i <= 100; i += 10) {
      await new Promise(resolve => setTimeout(resolve, 100));
      setDownloadProgress(i);
    }

    setDownloadLinks(links);
    setIsDownloading(false);
    setShowDownloadModal(true);
    
    setStatus(
      `🎉 成功生成 ${links.length} 个下载链接！\n` +
      `📍 区域：${getRegionInfo()}\n` +
      `📅 年份：${startYear} 至 ${endYear}\n` +
      `📦 导出模式：${exportMode}\n` +
      `📁 文件夹：${folderName}\n` +
      `💾 点击下方链接下载文件`
    );
    setStatusType('success');
  };

  // 重置所有选择
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
    setDownloadLinks([]);
    setShowDownloadModal(false);
  };

  // 模拟单个文件下载
  const handleSingleDownload = (fileName: string) => {
    // 创建模拟数据并下载
    const content = `CLCD土地利用数据模拟文件\n文件名: ${fileName}\n区域: ${getRegionInfo()}\n生成时间: ${new Date().toLocaleString()}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace('.tif', '.txt');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 批量下载所有文件
  const handleBatchDownload = () => {
    downloadLinks.forEach((link, index) => {
      setTimeout(() => {
        handleSingleDownload(link.name);
      }, index * 500);
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex">
      {/* 左侧控制面板 */}
      <div className="w-[400px] bg-white shadow-xl border-r border-gray-200 overflow-y-auto max-h-screen">
        <div className="p-5">
          {/* 标题 */}
          <h1 className="text-xl font-bold text-blue-600 mb-4 flex items-center gap-2">
            🏞️ CLCD土地利用数据批量下载
          </h1>
          
          <div className="h-0.5 bg-gray-200 mb-4"></div>

          {/* 区域选择 */}
          <div className="mb-4">
            <h2 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
              📍 选择研究区域
            </h2>
            
            <label className="block text-sm text-gray-600 mb-1">省份：</label>
            <select 
              className="w-full p-2 border border-gray-300 rounded-lg mb-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={selectedProvince}
              onChange={(e) => handleProvinceChange(e.target.value)}
            >
              <option value="">请选择省份...</option>
              {regionsData.map(p => (
                <option key={p.province} value={p.province}>{p.province}</option>
              ))}
            </select>

            <label className="block text-sm text-gray-600 mb-1">城市（可选，不选则下载全省）：</label>
            <select 
              className="w-full p-2 border border-gray-300 rounded-lg mb-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
              value={selectedCity}
              onChange={(e) => handleCityChange(e.target.value)}
              disabled={!selectedProvince}
            >
              <option value="">{selectedProvince ? '可选择特定城市或留空下载全省' : '请先选择省份'}</option>
              <option value="(全省)">(全省)</option>
              {cities.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <label className="block text-sm text-gray-600 mb-1">区县（可选，不选则下载全市/全省）：</label>
            
            {/* 全选/取消按钮 */}
            {counties.length > 0 && (
              <div className="flex gap-2 mb-2">
                <button 
                  onClick={selectAllCounties}
                  className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition"
                >
                  ✅ 全选
                </button>
                <button 
                  onClick={unselectAllCounties}
                  className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition"
                >
                  🚫 全不选
                </button>
              </div>
            )}

            {/* 区县列表 */}
            <div className="border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto bg-gray-50">
              {!selectedProvince && (
                <p className="text-gray-400 text-sm">请先选择省份</p>
              )}
              {selectedProvince && (!selectedCity || selectedCity === '(全省)') && (
                <p className="text-gray-400 text-sm">已选择全省，无需选择区县</p>
              )}
              {selectedCity && selectedCity !== '(全省)' && counties.length === 0 && (
                <p className="text-gray-400 text-sm">无可用区县</p>
              )}
              {counties.length > 0 && (
                <div className="space-y-1">
                  {counties.map(county => (
                    <label key={county} className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                      <input 
                        type="checkbox"
                        checked={selectedCounties.includes(county)}
                        onChange={() => handleCountyToggle(county)}
                        className="rounded text-blue-600"
                      />
                      <span className="text-sm">{county}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="h-0.5 bg-gray-200 mb-4"></div>

          {/* 年份和导出设置 */}
          <div className="mb-4">
            <h2 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
              📅 年份选择与导出设置
            </h2>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">起始年份：</label>
                <select 
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  value={startYear}
                  onChange={(e) => { setStartYear(e.target.value); setIsPreviewMode(false); }}
                >
                  {years.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">结束年份：</label>
                <select 
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  value={endYear}
                  onChange={(e) => { setEndYear(e.target.value); setIsPreviewMode(false); }}
                >
                  {years.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>

            <label className="block text-sm text-gray-600 mb-1">导出模式：</label>
            <select 
              className="w-full p-2 border border-gray-300 rounded-lg mb-3 focus:ring-2 focus:ring-blue-500"
              value={exportMode}
              onChange={(e) => { setExportMode(e.target.value); setIsPreviewMode(false); }}
            >
              {exportModeOptions.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">导出分辨率：</label>
                <select 
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  value={scale}
                  onChange={(e) => { setScale(e.target.value); setIsPreviewMode(false); }}
                >
                  {scaleOptions.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">导出坐标系：</label>
                <select 
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  value={crs}
                  onChange={(e) => { setCrs(e.target.value); setIsPreviewMode(false); }}
                >
                  {crsOptions.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="h-0.5 bg-gray-200 mb-4"></div>

          {/* 分类说明 */}
          <div className="mb-4">
            <h2 className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
              🏷️ 土地利用分类说明
            </h2>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {landUseClasses.map(cls => (
                <div key={cls.value} className="flex items-center gap-2 p-1">
                  <div 
                    className="w-4 h-4 rounded border border-gray-300"
                    style={{ backgroundColor: cls.color }}
                  ></div>
                  <span>{cls.value}-{cls.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="h-0.5 bg-gray-200 mb-4"></div>

          {/* 按钮区域 */}
          <div className="space-y-2 mb-4">
            <div className="flex gap-2">
              <button 
                onClick={handlePreview}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium flex items-center justify-center gap-2"
              >
                🔍 预览数据
              </button>
              <button 
                onClick={handleReset}
                className="flex-1 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium flex items-center justify-center gap-2"
              >
                🔄 重置
              </button>
            </div>
            
            <button 
              onClick={handleDownload}
              disabled={isDownloading}
              className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading ? (
                <>
                  <span className="animate-spin">⏳</span>
                  准备中 {downloadProgress}%
                </>
              ) : (
                <>⬇️ 立即下载（无需跳转Task面板）</>
              )}
            </button>
          </div>

          <div className="h-0.5 bg-gray-200 mb-4"></div>

          {/* 状态显示 */}
          <div 
            className={`p-3 rounded-lg text-sm whitespace-pre-wrap ${
              statusType === 'success' ? 'bg-green-50 text-green-700' :
              statusType === 'error' ? 'bg-red-50 text-red-700' :
              statusType === 'warning' ? 'bg-yellow-50 text-yellow-700' :
              'bg-gray-50 text-gray-600'
            }`}
          >
            {status}
          </div>
        </div>
      </div>

      {/* 右侧主要区域 */}
      <div className="flex-1 p-6 overflow-y-auto">
        {/* 使用说明和模拟地图 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 模拟地图区域 */}
          <div className="bg-white rounded-xl shadow-lg p-4">
            <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
              🗺️ 区域预览
            </h3>
            <div className="bg-gradient-to-br from-green-100 via-yellow-50 to-blue-100 rounded-lg h-80 flex items-center justify-center border-2 border-dashed border-gray-300 relative overflow-hidden">
              {isPreviewMode ? (
                <div className="text-center p-4">
                  <div className="text-4xl mb-3">🎯</div>
                  <div className="text-lg font-bold text-gray-700">已选择区域</div>
                  <div className="text-sm text-gray-500 mt-2">{getRegionInfo()}</div>
                  <div className="mt-4 p-3 bg-white/80 rounded-lg">
                    <div className="grid grid-cols-5 gap-1">
                      {landUseClasses.map(cls => (
                        <div 
                          key={cls.value}
                          className="h-8 rounded"
                          style={{ backgroundColor: cls.color }}
                          title={cls.name}
                        ></div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">CLCD土地利用分类示意</p>
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-400">
                  <div className="text-5xl mb-3">🌍</div>
                  <p>选择区域后点击"预览数据"查看</p>
                </div>
              )}
            </div>
          </div>

          {/* 使用说明 */}
          <div className="bg-white rounded-xl shadow-lg p-4">
            <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
              📖 使用说明
            </h3>
            <div className="text-sm text-gray-600 space-y-2">
              <p><strong>操作步骤：</strong></p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>必须选择省份</li>
                <li>城市可选：不选城市 = 下载全省数据</li>
                <li>区县可选：不选区县 = 下载全市/全省数据</li>
                <li>选择起始和结束年份</li>
                <li>选择导出模式、分辨率和坐标系</li>
                <li>点击"预览数据"查看区域</li>
                <li className="text-green-600 font-medium">点击"立即下载"直接生成下载链接</li>
              </ol>
              
              <p className="mt-3"><strong>💡 智能选择规则：</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>只选省份 = 下载全省</li>
                <li>选省份+城市 = 下载该城市全市</li>
                <li>选省份+城市+区县 = 下载指定区县</li>
              </ul>

              <p className="mt-3"><strong>📌 CLCD 数据说明：</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>数据源：CLCD土地利用数据</li>
                <li>空间分辨率：30米</li>
                <li>时间范围：1985年, 1990-2024年</li>
                <li>原始分类：10个土地覆盖类型</li>
              </ul>

              <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                <p className="text-green-700 font-medium">✨ 新增功能</p>
                <p className="text-green-600 text-xs mt-1">
                  本工具支持直接在页面上下载，无需跳转到Google Earth Engine的Task面板！
                  点击"立即下载"按钮即可生成下载链接。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 下载链接区域 */}
        {downloadLinks.length > 0 && (
          <div className="mt-6 bg-white rounded-xl shadow-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                📥 下载链接 ({downloadLinks.length} 个文件)
              </h3>
              <button 
                onClick={handleBatchDownload}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
              >
                📦 批量下载全部
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {downloadLinks.map((link, index) => (
                <button
                  key={index}
                  onClick={() => handleSingleDownload(link.name)}
                  className="flex items-center gap-2 p-3 bg-gray-50 hover:bg-blue-50 rounded-lg transition border border-gray-200 hover:border-blue-300"
                >
                  <span className="text-2xl">📄</span>
                  <span className="text-sm text-gray-700 truncate">{link.name}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              💡 提示：由于浏览器安全限制，这里生成的是模拟数据文件。实际使用时请连接Google Earth Engine API获取真实数据。
            </p>
          </div>
        )}

        {/* 数据年份可用性说明 */}
        <div className="mt-6 bg-white rounded-xl shadow-lg p-4">
          <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
            📊 数据年份可用性
          </h3>
          <div className="flex flex-wrap gap-2">
            {years.map(year => (
              <div 
                key={year}
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  parseInt(year) >= parseInt(startYear) && parseInt(year) <= parseInt(endYear)
                    ? 'bg-green-100 text-green-700 border-2 border-green-400'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {year}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            绿色边框表示当前选择的年份范围。注意：1986-1989年数据不可用。
          </p>
        </div>
      </div>

      {/* 下载进度弹窗 */}
      {showDownloadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">下载任务已生成！</h3>
              <p className="text-gray-600 mb-4">
                已生成 {downloadLinks.length} 个文件的下载链接，请在下方下载区域点击下载。
              </p>
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-left">
                <p className="text-sm text-gray-600">
                  <strong>区域：</strong>{getRegionInfo()}<br/>
                  <strong>年份：</strong>{startYear} - {endYear}<br/>
                  <strong>文件数：</strong>{downloadLinks.length} 个
                </p>
              </div>
              <button 
                onClick={() => setShowDownloadModal(false)}
                className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
              >
                确定，去下载
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
