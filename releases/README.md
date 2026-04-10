# Chrome MCP Server Extension - Latest Release

## 🚀 快速安装

### 1. 下载扩展

下载 [chrome-mcp-server-latest.zip](/releases/chrome-extension/latest/chrome-mcp-server-lastest.zip)

### 2. 安装步骤

1. 解压下载的 zip 文件
2. 打开 Chrome 浏览器
3. 地址栏输入 `chrome://extensions/`
4. 开启右上角的"开发者模式"开关
5. 点击"加载已解压的扩展程序"
6. 选择解压后的文件夹

### 3. 验证安装

- 扩展图标应该出现在浏览器工具栏
- 点击图标打开配置面板
- 确认扩展状态显示正常

## ⚙️ 配置说明

### Native Server 连接

1. 确保 Native Server 正在运行（默认端口 12306）
2. 在扩展 popup 中输入正确的端口号
3. 点击"连接"按钮测试连接

## 🔧 故障排除

### 常见问题

1. **扩展无法加载**

   - 确保已开启开发者模式
   - 检查文件夹结构是否完整

2. **无法连接 Native Server**

   - 确认 Native Server 正在运行
   - 检查端口号是否正确
   - 查看浏览器控制台错误信息

3. **功能异常**
   - 刷新页面重试
   - 重启浏览器
   - 重新加载扩展

## 📞 技术支持

遇到问题请：

1. 查看浏览器控制台错误信息
2. 在 GitHub Issues 中搜索相似问题
3. 提交新的 Issue 并附上详细信息

## ⚠️ 安全提醒

- 此扩展具有较高权限，请确保从可信来源下载
