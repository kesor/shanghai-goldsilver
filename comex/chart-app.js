import {loadAllData} from './data-loader.js';
import {buildFlowGraph} from './flow-builder.js';
import {renderMiniCharts} from './mini-charts.js';
import {renderSankey} from './sankey-renderer.js';

export async function initChart(commodity) {
  let data = null;
  let graph = null;
  
  async function doRender() {
    try {
      if (!data) {
        data = await loadAllData(commodity);
        if (!data || data.length === 0) {
          console.error('No data available');
          return;
        }
        graph = buildFlowGraph(data);
      }
      renderMiniCharts(data);
      renderSankey(data, graph);
    } catch (e) {
      console.error('Error rendering chart:', e);
    }
  }

  window.addEventListener('resize', doRender);
  await doRender();
  
  const chartDiv = document.getElementById('chart');
  const scrollbarDiv = document.getElementById('scrollbar-container');
  const scrollbarContent = document.getElementById('scrollbar-content');
  
  if (!chartDiv || !scrollbarDiv || !scrollbarContent) {
    console.error('Required DOM elements not found');
    return;
  }
  
  scrollbarContent.style.width = chartDiv.scrollWidth + 'px';
  scrollbarDiv.addEventListener('scroll', () => chartDiv.scrollLeft = scrollbarDiv.scrollLeft);
  chartDiv.addEventListener('scroll', () => scrollbarDiv.scrollLeft = chartDiv.scrollLeft);
  chartDiv.scrollLeft = chartDiv.scrollWidth;
  scrollbarDiv.scrollLeft = scrollbarDiv.scrollWidth;
}
