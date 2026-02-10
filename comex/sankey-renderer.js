import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import {sankey as d3Sankey, sankeyLinkHorizontal} from 'https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/+esm';
import {compareContracts, fmtMMDD, fmtContract, getContractValue, getDayName} from './utils.js';

export function renderSankey(data, graph) {
  const container = d3.select('#chart');
  container.selectAll('*').remove();
  
  const margin = {top: 20, right: 20, bottom: 80, left: 150};
  const width = 245 * data.length;
  const height = container.node().clientHeight - margin.top - margin.bottom;
  
  const svg = container.append('svg').attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const sankey = d3Sankey().nodeWidth(15).nodePadding(14).nodeSort(null)
    .linkSort((a, b) => (a.source.isExt && a.source.isAdded) && !(b.source.isExt && b.source.isAdded) ? -1 : !(a.source.isExt && a.source.isAdded) && (b.source.isExt && b.source.isAdded) ? 1 : 0)
    .extent([[1, 1], [width - 1, height - 6]]);

  const sankeyData = sankey({nodes: graph.nodes.map(n => ({...n})), links: graph.links.map(l => ({...l}))});
  positionNodes(sankeyData, data, width / data.length);
  adjustNodePadding(sankeyData);
  sankey.update(sankeyData);

  const contracts = [...new Set(graph.nodes.filter(n => !n.isExt).map(n => n.contract))];
  const colorScale = d3.scaleOrdinal(d3.schemeTableau10.map(c => d3.color(c).darker(0.3))).domain(contracts);
  const volumeScales = new Map();
  contracts.forEach(contract => {
    const volumes = data.map(d => getContractValue(d, contract, 'totalVolume')).filter(v => v > 0);
    if (volumes.length > 0) volumeScales.set(contract, d3.scaleLinear().domain([Math.min(...volumes), Math.max(...volumes)]).range([0.3, 1.0]));
  });

  drawLinks(g, sankeyData, data, colorScale, volumeScales);
  drawNodes(g, sankeyData, data, colorScale);
  drawHeaders(g, sankeyData, data);
}

function adjustNodePadding(sankeyData) {
  const nodesByColumn = {};
  sankeyData.nodes.forEach(node => {
    if (!nodesByColumn[node.column]) nodesByColumn[node.column] = [];
    nodesByColumn[node.column].push(node);
  });
  
  Object.values(nodesByColumn).forEach(nodesInColumn => {
    let currentY = nodesInColumn[0].y0;
    nodesInColumn.forEach(node => {
      const nodeHeight = node.y1 - node.y0;
      const textHeight = node.isExt ? 12 : 36;
      const minPadding = Math.max(14, textHeight - nodeHeight + 8);
      node.y0 = currentY;
      node.y1 = currentY + nodeHeight;
      currentY = node.y1 + minPadding;
    });
  });
}

function positionNodes(sankeyData, data, columnWidth) {
  const nodesByColumn = {};
  sankeyData.nodes.forEach(node => {
    if (!nodesByColumn[node.column]) nodesByColumn[node.column] = [];
    nodesByColumn[node.column].push(node);
  });
  
  Object.values(nodesByColumn).forEach(nodesInColumn => {
    let sortedNodes = nodesInColumn.filter(n => !n.isExt).sort((a, b) => compareContracts(a.contract, b.contract));
    const addedNode = nodesInColumn.find(n => n.isExt && n.isAdded);
    const removedNode = nodesInColumn.find(n => n.isExt && !n.isAdded);
    
    if (addedNode) sortedNodes = insertExtNode(sortedNodes, addedNode, sankeyData, true);
    if (removedNode) sortedNodes = insertExtNode(sortedNodes, removedNode, sankeyData, false);
    
    nodesInColumn.length = 0;
    nodesInColumn.push(...sortedNodes);
    
    let currentY = 75;
    nodesInColumn.forEach(node => {
      const nodeHeight = node.y1 - node.y0;
      node.x0 = node.column * columnWidth;
      node.x1 = node.x0 + 15;
      node.y0 = currentY;
      node.y1 = currentY + nodeHeight;
      currentY = node.y1 + 14;
    });
  });
}

function insertExtNode(sortedNodes, extNode, sankeyData, isAdded) {
  const links = isAdded 
    ? sankeyData.links.filter(l => l.source === extNode && !l.target.isExt).map(l => l.target)
    : sankeyData.links.filter(l => l.target === extNode && !l.source.isExt).map(l => l.source);
  
  if (links.length === 0) return isAdded ? [extNode, ...sortedNodes] : [...sortedNodes, extNode];
  
  if (isAdded) {
    const firstTarget = links.sort((a, b) => compareContracts(a.contract, b.contract))[0];
    const insertIndex = sortedNodes.findIndex(n => compareContracts(n.contract, firstTarget.contract) >= 0);
    if (insertIndex >= 0) sortedNodes.splice(insertIndex, 0, extNode);
    else sortedNodes.push(extNode);
  } else {
    const lastSourceIndex = sortedNodes.reduce((maxIdx, n, idx) => links.some(s => s.contract === n.contract) ? idx : maxIdx, -1);
    if (lastSourceIndex >= 0) sortedNodes.splice(lastSourceIndex + 1, 0, extNode);
    else sortedNodes.push(extNode);
  }
  return sortedNodes;
}

function drawLinks(g, sankeyData, data, colorScale, volumeScales) {
  g.append('g').selectAll('path').data(sankeyData.links).join('path')
    .attr('d', sankeyLinkHorizontal())
    .attr('stroke', d => d.source.isExt && d.source.isAdded && d.target.contract ? colorScale(d.target.contract) : d.source.isExt ? '#999' : colorScale(d.source.contract) || '#1f77b4')
    .attr('stroke-width', d => Math.max(1, d.width))
    .attr('fill', 'none')
    .attr('class', 'link')
    .style('opacity', d => {
      if (d.source.isExt && d.source.isAdded && d.target.contract) {
        const scale = volumeScales.get(d.target.contract);
        if (scale && d.target.column > 0) {
          const vol = getContractValue(data[d.target.column - 1], d.target.contract, 'totalVolume');
          return vol > 0 ? scale(vol) : 0.3;
        }
      }
      if (!d.source.isExt && d.source.contract) {
        const scale = volumeScales.get(d.source.contract);
        if (scale) {
          const dayData = data.find(day => day.tradeDate === d.source.date);
          if (dayData) {
            const vol = getContractValue(dayData, d.source.contract, 'totalVolume');
            return vol > 0 ? scale(vol) : 0.3;
          }
        }
      }
      return 0.6;
    })
    .append('title')
    .text(d => `${fmtContract(d.source.contract || (d.source.isAdded ? 'Added' : 'Removed'))} → ${fmtContract(d.target.contract || (d.target.isAdded ? 'Added' : 'Removed'))}\n${d.value.toLocaleString()}`);
}

function drawNodes(g, sankeyData, data, colorScale) {
  const node = g.append('g').selectAll('g').data(sankeyData.nodes).join('g').attr('class', 'node');

  node.each(function(d) {
    const g = d3.select(this);
    if (d.isExt) {
      const pathData = d.isAdded ? `M ${d.x1} ${d.y0} L ${d.x0} ${d.y0} L ${d.x0} ${d.y1} L ${d.x1} ${d.y1}` : `M ${d.x0} ${d.y0} L ${d.x1} ${d.y0} L ${d.x1} ${d.y1} L ${d.x0} ${d.y1}`;
      g.append('path').attr('d', pathData).attr('fill', 'white').attr('stroke', '#ccc').attr('stroke-width', 1);
    } else {
      const isNew = d.column > 0 && !sankeyData.nodes.some(n => n.date === data[d.column - 1].tradeDate && n.contract === d.contract && !n.isExt);
      g.append('rect')
        .attr('x', d.x0).attr('y', d.y0).attr('height', d.y1 - d.y0).attr('width', d.x1 - d.x0)
        .attr('fill', isNew ? 'white' : colorScale(d.contract) || '#1f77b4')
        .attr('fill-opacity', 0.4)
        .attr('stroke', d3.color(colorScale(d.contract) || '#1f77b4').darker(0.5))
        .attr('stroke-width', isNew ? 2 : 1)
        .attr('stroke-dasharray', isNew ? '5,3' : null)
        .append('title').text(`${fmtMMDD(d.date)} ${fmtContract(d.contract)}`);
    }
  });

  node.each(function(d) {
    const g = d3.select(this);
    const x = d.isExt && d.isAdded ? d.x0 - 6 : d.x1 + 6;
    const anchor = d.isExt && d.isAdded ? 'end' : 'start';
    
    if (d.isExt) {
      const total = (d.sourceLinks || []).reduce((sum, link) => sum + link.value, 0) + (d.targetLinks || []).reduce((sum, link) => sum + link.value, 0);
      g.append('text').attr('x', x).attr('y', (d.y1 + d.y0) / 2).attr('dy', '0.35em').attr('text-anchor', anchor).style('font-size', '12px')
        .text(`${d.isAdded ? 'Added' : 'Removed'} | ${total.toLocaleString()}`);
    } else {
      const dayData = data.find(day => day.tradeDate === d.date);
      if (!dayData) {
        g.append('text').attr('x', x).attr('y', (d.y1 + d.y0) / 2).attr('dy', '0.35em').attr('text-anchor', anchor).style('font-size', '12px').text(fmtContract(d.contract));
        return;
      }
      
      const oi = getContractValue(dayData, d.contract, 'atClose');
      const vol = getContractValue(dayData, d.contract, 'totalVolume');
      const prevDayData = d.column > 0 ? data[d.column - 1] : null;
      const prevOI = prevDayData ? getContractValue(prevDayData, d.contract, 'atClose') : 0;
      const prevVol = prevDayData ? getContractValue(prevDayData, d.contract, 'totalVolume') : 0;
      const deltaOI = prevOI > 0 ? oi - prevOI : 0;
      const deltaVol = prevVol > 0 ? vol - prevVol : 0;
      
      const oiStr = oi.toLocaleString();
      const volStr = vol.toLocaleString();
      const deltaOIStr = deltaOI !== 0 ? `(${(deltaOI > 0 ? '+' : '') + deltaOI.toLocaleString()})` : '';
      const deltaVolStr = deltaVol !== 0 ? `(${(deltaVol > 0 ? '+' : '') + deltaVol.toLocaleString()})` : '';
      
      const maxMain = Math.max(oiStr.length, volStr.length);
      const maxDelta = Math.max(deltaOIStr.length, deltaVolStr.length);
      
      const lines = [
        {text: fmtContract(d.contract), mono: false},
        {text: `\u00a0OI:\u00a0${'\u00a0'.repeat(maxMain - oiStr.length)}${oiStr}\u00a0\u00a0${'\u00a0'.repeat(maxDelta - deltaOIStr.length)}${deltaOIStr}`, mono: true},
        {text: `Vol:\u00a0${'\u00a0'.repeat(maxMain - volStr.length)}${volStr}\u00a0\u00a0${'\u00a0'.repeat(maxDelta - deltaVolStr.length)}${deltaVolStr}`, mono: true}
      ];
      const lineHeight = 12;
      const nodeHeight = d.y1 - d.y0;
      const startY = nodeHeight < 28 ? d.y0 : (d.y1 + d.y0) / 2 - (lines.length - 1) * lineHeight / 2;
      
      lines.forEach((line, i) => {
        g.append('text').attr('x', x).attr('y', startY + i * lineHeight).attr('dy', '0.35em').attr('text-anchor', anchor).style('font-size', '10px').style('font-family', line.mono ? 'monospace' : 'sans-serif').text(line.text);
      });
    }
  });
}

function drawHeaders(g, sankeyData, data) {
  const columnPositions = {};
  sankeyData.nodes.forEach(node => {
    if (!columnPositions[node.column]) columnPositions[node.column] = {minX: node.x0, maxX: node.x1, date: node.date};
    else {
      columnPositions[node.column].minX = Math.min(columnPositions[node.column].minX, node.x0);
      columnPositions[node.column].maxX = Math.max(columnPositions[node.column].maxX, node.x1);
    }
  });

  const headers = Object.values(columnPositions).map(pos => {
    const dayData = data.find(d => d.tradeDate === pos.date);
    return {
      x: (pos.minX + pos.maxX) / 2,
      label: fmtMMDD(pos.date),
      dayName: getDayName(pos.date),
      totalOI: (dayData.monthData || []).reduce((sum, item) => sum + getContractValue(dayData, item.monthID, 'atClose'), 0),
      totalVol: (dayData.monthData || []).reduce((sum, item) => sum + getContractValue(dayData, item.monthID, 'totalVolume'), 0)
    };
  });

  [{cls: 'column-volume', y: 26, fmt: d => `Vol: ${d.totalVol.toLocaleString()}`},
   {cls: 'column-oi', y: 38, fmt: d => `OI: ${d.totalOI.toLocaleString()}`},
   {cls: 'column-header', y: 50, fmt: d => d.label, bold: true, size: '12px'},
   {cls: 'column-day', y: 62, fmt: d => d.dayName, bold: true}
  ].forEach(cfg => {
    g.selectAll(`.${cfg.cls}`).data(headers).join('text')
      .attr('class', cfg.cls)
      .attr('x', d => d.x)
      .attr('y', cfg.y)
      .attr('text-anchor', 'middle')
      .style('font-size', cfg.size || '10px')
      .style('font-weight', cfg.bold ? 'bold' : 'normal')
      .text(cfg.fmt);
  });
}
