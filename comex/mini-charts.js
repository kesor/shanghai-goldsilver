import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import {cleanNumber, fmtMMDD, getDayName} from './utils.js';

export function renderMiniCharts(data) {
  if (!data || data.length === 0) return;
  
  const totals = data.map(dayData => ({
    date: dayData.tradeDate,
    dayName: getDayName(dayData.tradeDate),
    oi: (dayData.monthData || []).reduce((sum, item) => sum + cleanNumber(item.atClose), 0),
    vol: (dayData.monthData || []).reduce((sum, item) => sum + cleanNumber(item.totalVolume), 0)
  }));

  const config = {barWidth: 8, barGap: 2, margin: {top: 5, right: 5, bottom: 18, left: 50}, height: 75};
  const tooltip = d3.select('#chart-tooltip');

  renderBarChart('#oi-chart', totals, 'oi', 'Total OI', '#4682b4', config, tooltip);
  renderBarChart('#vol-chart', totals, 'vol', 'Total Vol', '#ff7f0e', config, tooltip);
}

function renderBarChart(selector, data, metric, label, color, config, tooltip) {
  const {barWidth, barGap, margin, height} = config;
  const width = (barWidth + barGap) * data.length - barGap;
  
  const svg = d3.select(selector);
  svg.selectAll('*').remove();
  svg.attr('width', width + margin.left + margin.right);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  
  const maxVal = d3.max(data, d => d[metric]) || 1;
  const scale = d3.scaleLinear().domain([0, maxVal]).range([height, 0]);
  
  g.selectAll('rect').data(data).join('rect')
    .attr('x', (d, i) => i * (barWidth + barGap))
    .attr('y', d => scale(d[metric]))
    .attr('width', barWidth)
    .attr('height', d => height - scale(d[metric]))
    .attr('fill', color)
    .on('mouseover', (e, d) => tooltip.style('display', 'block').html(`${d.dayName}, ${fmtMMDD(d.date)}<br/>${label}: ${d[metric].toLocaleString()}`))
    .on('mousemove', e => tooltip.style('left', (e.clientX - tooltip.node().offsetWidth - 15) + 'px').style('top', (e.clientY - 30) + 'px'))
    .on('mouseout', () => tooltip.style('display', 'none'));
  
  g.append('text').attr('x', -5).attr('y', height / 2).attr('text-anchor', 'end').attr('dominant-baseline', 'middle').text(label);
  g.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', height).attr('stroke', '#999').attr('stroke-width', 1);
  g.append('line').attr('x1', 0).attr('y1', height).attr('x2', width).attr('y2', height).attr('stroke', '#999').attr('stroke-width', 1);
  g.append('text').attr('x', -5).attr('y', 0).attr('text-anchor', 'end').attr('dominant-baseline', 'middle').style('font-size', '9px').text((maxVal / 1000).toFixed(0) + 'k');
  g.append('text').attr('x', 0).attr('y', height + 12).attr('text-anchor', 'start').style('font-size', '9px').text(fmtMMDD(data[0].date));
  g.append('text').attr('x', width).attr('y', height + 12).attr('text-anchor', 'end').style('font-size', '9px').text(fmtMMDD(data[data.length - 1].date));
}
