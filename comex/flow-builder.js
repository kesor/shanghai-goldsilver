import {cleanNumber, parseMonthID, getContractValue, compareContracts} from './utils.js';

export function buildFlowGraph(data) {
  const contractsByDay = new Map();
  
  data.forEach(dayData => {
    const contractsWithDates = (dayData.monthData || [])
      .filter(item => cleanNumber(item.atClose) > 0)
      .map(item => {
        const [year, month] = parseMonthID(item.monthID);
        return {contract: item.monthID, year, month};
      })
      .filter(c => c.year !== 9999)
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
    
    contractsByDay.set(dayData.tradeDate, contractsWithDates.slice(0, 7).map(c => c.contract));
  });
  
  const contracts = [...new Set([...contractsByDay.values()].flat())].sort(compareContracts);

  const nodes = [];
  const nodeIdMap = new Map();

  for (let dayIdx = 0; dayIdx < data.length; dayIdx++) {
    const date = data[dayIdx].tradeDate;
    const dayContracts = contractsByDay.get(date) || [];
    
    dayContracts.forEach(contract => {
      const id = `${date}_${contract}`;
      nodeIdMap.set(id, nodes.length);
      nodes.push({id, date, column: dayIdx, contract, isExt: false});
    });
    
    if (dayIdx > 0) {
      const inId = `${date}_EXT_IN`;
      const outId = `${date}_EXT_OUT`;
      nodeIdMap.set(inId, nodes.length);
      nodes.push({id: inId, date, column: dayIdx, isExt: true, isAdded: true});
      nodeIdMap.set(outId, nodes.length);
      nodes.push({id: outId, date, column: dayIdx, isExt: true, isAdded: false});
    }
  }

  const links = [];

  for (let dayIdx = 0; dayIdx < data.length - 1; dayIdx++) {
    const currDay = data[dayIdx], nextDay = data[dayIdx + 1];
    const currDate = currDay.tradeDate, nextDate = nextDay.tradeDate;
    const surpluses = [], deficits = [];

    for (const contract of contracts) {
      const currValue = getContractValue(currDay, contract, 'atClose');
      const nextValue = getContractValue(nextDay, contract, 'atClose');
      
      const baseFlow = Math.min(currValue, nextValue);
      if (baseFlow > 0) {
        const src = nodeIdMap.get(`${currDate}_${contract}`);
        const tgt = nodeIdMap.get(`${nextDate}_${contract}`);
        if (src !== undefined && tgt !== undefined) links.push({source: src, target: tgt, value: baseFlow});
      }
      
      const diff = nextValue - currValue;
      if (diff > 0) deficits.push({contract, needed: diff});
      else if (diff < 0) surpluses.push({contract, available: Math.abs(diff)});
    }

    for (const deficit of deficits) {
      let stillNeeded = deficit.needed;
      
      for (const surplus of surpluses) {
        if (stillNeeded <= 0 || surplus.available <= 0) continue;
        const flow = Math.min(stillNeeded, surplus.available);
        const src = nodeIdMap.get(`${currDate}_${surplus.contract}`);
        const tgt = nodeIdMap.get(`${nextDate}_${deficit.contract}`);
        if (src !== undefined && tgt !== undefined) links.push({source: src, target: tgt, value: flow});
        surplus.available -= flow;
        stillNeeded -= flow;
      }
      
      if (stillNeeded > 0) {
        const src = nodeIdMap.get(`${currDate}_EXT_IN`);
        const tgt = nodeIdMap.get(`${nextDate}_${deficit.contract}`);
        if (src !== undefined && tgt !== undefined) links.push({source: src, target: tgt, value: stillNeeded});
      }
    }

    for (const surplus of surpluses) {
      if (surplus.available > 0) {
        const src = nodeIdMap.get(`${currDate}_${surplus.contract}`);
        const tgt = nodeIdMap.get(`${nextDate}_EXT_OUT`);
        if (src !== undefined && tgt !== undefined) links.push({source: src, target: tgt, value: surplus.available});
      }
    }
  }

  const usedNodeIds = new Set();
  links.forEach(link => {
    usedNodeIds.add(nodes[link.source].id);
    usedNodeIds.add(nodes[link.target].id);
  });
  
  const filteredNodes = nodes.filter(node => !node.isExt || usedNodeIds.has(node.id));
  const nodeIndexMap = new Map();
  filteredNodes.forEach((node, index) => nodeIndexMap.set(node.id, index));
  
  const filteredLinks = links.map(link => ({
    source: nodeIndexMap.get(nodes[link.source].id),
    target: nodeIndexMap.get(nodes[link.target].id),
    value: link.value
  })).filter(link => link.source !== undefined && link.target !== undefined);

  return {nodes: filteredNodes, links: filteredLinks};
}
