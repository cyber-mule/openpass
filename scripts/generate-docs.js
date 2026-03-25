/**
 * 生成操作文档 PNG
 * 运行: node scripts/generate-docs.js
 */

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

async function generateDocs() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();

  // 设置视口大小
  await page.setViewport({
    width: 1200,
    height: 1600,
    deviceScaleFactor: 2 // 高清
  });

  // 加载 HTML 文件
  const htmlPath = path.join(__dirname, '../docs/user-guide.html');
  const fileUrl = `file://${htmlPath}`;

  console.log('正在生成文档...');

  await page.goto(fileUrl, {
    waitUntil: 'networkidle0'
  });

  // 获取页面高度
  const bodyHeight = await page.evaluate(() => {
    return document.body.scrollHeight;
  });

  // 设置页面高度
  await page.setViewport({
    width: 1200,
    height: bodyHeight,
    deviceScaleFactor: 2
  });

  // 等待字体加载
  await page.evaluateHandle('document.fonts.ready');

  // 截图
  const outputPath = path.join(__dirname, '../docs/user-guide.png');
  await page.screenshot({
    path: outputPath,
    fullPage: true
  });

  console.log(`文档已生成: ${outputPath}`);

  // 生成各个页面的截图
  const sections = await page.evaluate(() => {
    const sections = document.querySelectorAll('.section');
    return Array.from(sections).map((section, index) => ({
      index,
      title: section.querySelector('.section-title')?.textContent?.trim() || `Section ${index + 1}`
    }));
  });

  // 为每个章节单独截图
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const element = await page.$(`.section:nth-child(${i + 3})`); // +3 因为有封面等元素

    if (element) {
      const sectionPath = path.join(__dirname, `../docs/section-${i + 1}.png`);
      await element.screenshot({
        path: sectionPath
      });
      console.log(`章节截图: ${sectionPath}`);
    }
  }

  await browser.close();
  console.log('完成！');
}

generateDocs().catch(console.error);