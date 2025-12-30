// Minimal d3 functions for testing
const d3 = {
    group(data, keyFn) {
        const groups = new Map();
        for (const item of data) {
            const key = keyFn(item);
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(item);
        }
        return groups;
    },
    max(data, accessor) {
        if (!data || data.length === 0) return undefined;
        if (accessor) return Math.max(...data.map(accessor));
        return Math.max(...data);
    },
    min(data, accessor) {
        if (!data || data.length === 0) return undefined;
        if (accessor) return Math.min(...data.map(accessor));
        return Math.min(...data);
    }
};

// Constants
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

// Business logic functions to test
function floorToIntervalShanghai(ms, intervalMs) {
    return (
        Math.floor((ms + SHANGHAI_OFFSET_MS) / intervalMs) * intervalMs -
        SHANGHAI_OFFSET_MS
    );
}

function createOHLC(data, intervalMin = 5) {
    if (!data?.length) return [];

    const nowMs = Date.now();
    const nowShanghaiMs = nowMs + SHANGHAI_OFFSET_MS;
    const intervalMs = intervalMin * 60_000;

    const rows = data
        .map((d) => {
            const t = new Date(d.timestamp);
            const price = +d.price_cny;
            const rate = +d.usd_cny_rate;
            return { t, price, rate };
        })
        .filter((d) => !Number.isNaN(d.t.getTime()) && Number.isFinite(d.price))
        .filter((d) => d.t.getTime() + SHANGHAI_OFFSET_MS <= nowShanghaiMs)
        .sort((a, b) => a.t - b.t);
    
    const grouped = d3.group(rows, (d) =>
        floorToIntervalShanghai(d.t.getTime(), intervalMs),
    );

    return Array.from(grouped, ([bucketMs, values]) => {
        return {
            date: new Date(bucketMs),
            open: values[0].price,
            close: values[values.length - 1].price,
            high: d3.max(values, (v) => v.price),
            low: d3.min(values, (v) => v.price),
            fx_close: values[values.length - 1].rate,
        };
    }).sort((a, b) => a.date - b.date);
}

function shanghaiMidnightUtcMs(msUtc) {
    const sh = msUtc + SHANGHAI_OFFSET_MS;
    const day = Math.floor(sh / DAY_MS);
    return day * DAY_MS - SHANGHAI_OFFSET_MS;
}

function shanghaiHM(msUtc) {
    const d = new Date(msUtc + SHANGHAI_OFFSET_MS);
    return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}

function shanghaiTimeUtcMs(day0UtcMs, hh, mm) {
    return day0UtcMs + (hh * 60 + mm) * MINUTE_MS;
}

function fmtTickShanghai(date) {
    const ms = date.getTime() + SHANGHAI_OFFSET_MS;
    const d = new Date(ms);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

function assert(condition, message = 'Assertion failed') {
    if (!condition) throw new Error(message);
}

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
    } catch (e) {
        console.log(`✗ ${name}: ${e.message}`);
        process.exit(1);
    }
}

// Test createOHLC
test('createOHLC with empty data', () => {
    const result = createOHLC([]);
    assert(result.length === 0, 'Should return empty array');
});

test('createOHLC with null data', () => {
    const result = createOHLC(null);
    assert(result.length === 0, 'Should return empty array for null');
});

test('createOHLC with single point', () => {
    const data = [{
        timestamp: "2021-12-31T14:30:00+08:00",
        price_cny: 500.0,
        usd_cny_rate: 7.0
    }];
    
    // Mock Date.now to be after our test data
    const originalNow = Date.now;
    Date.now = () => 1640995200000; // 2022-01-01 00:00:00 UTC
    
    const result = createOHLC(data);
    
    Date.now = originalNow; // Restore
    
    assert(result.length === 1, 'Should create one candle');
    assert(result[0].open === 500.0, 'Open should be 500.0');
    assert(result[0].close === 500.0, 'Close should be 500.0');
    assert(result[0].high === 500.0, 'High should be 500.0');
    assert(result[0].low === 500.0, 'Low should be 500.0');
});

test('createOHLC with multiple points same bucket', () => {
    const data = [
        {timestamp: "2021-12-31T14:30:00+08:00", price_cny: 500.0, usd_cny_rate: 7.0},
        {timestamp: "2021-12-31T14:31:00+08:00", price_cny: 510.0, usd_cny_rate: 7.1},
        {timestamp: "2021-12-31T14:32:00+08:00", price_cny: 495.0, usd_cny_rate: 7.2},
    ];
    
    const originalNow = Date.now;
    Date.now = () => 1640995200000;
    
    const result = createOHLC(data);
    
    Date.now = originalNow;
    
    assert(result.length === 1, 'Should create one candle');
    assert(result[0].open === 500.0, 'Open should be 500.0');
    assert(result[0].close === 495.0, 'Close should be 495.0');
    assert(result[0].high === 510.0, 'High should be 510.0');
    assert(result[0].low === 495.0, 'Low should be 495.0');
});

// Test Shanghai time utilities
test('shanghaiMidnightUtcMs', () => {
    const utcMs = 1640995200000; // 2022-01-01 00:00:00 UTC (08:00 Shanghai)
    const result = shanghaiMidnightUtcMs(utcMs);
    const expected = 1640966400000; // 2021-12-31 16:00:00 UTC (00:00 Shanghai)
    assert(result === expected, `Expected ${expected}, got ${result}`);
});

test('shanghaiHM', () => {
    const utcMs = 1640995200000; // 2022-01-01 00:00:00 UTC (08:00 Shanghai)
    const result = shanghaiHM(utcMs);
    assert(result.h === 8, `Expected hour 8, got ${result.h}`);
    assert(result.m === 0, `Expected minute 0, got ${result.m}`);
});

test('shanghaiTimeUtcMs', () => {
    const day0Utc = 1640966400000; // 2021-12-31 16:00:00 UTC (00:00 Shanghai)
    const result = shanghaiTimeUtcMs(day0Utc, 14, 30);
    const expected = day0Utc + (14 * 60 + 30) * 60 * 1000;
    assert(result === expected, `Expected ${expected}, got ${result}`);
});

// Test axis formatting
test('fmtTickShanghai', () => {
    const date = new Date(1640995200000); // 2022-01-01 00:00:00 UTC
    const result = fmtTickShanghai(date);
    assert(result === "08:00", `Expected "08:00", got "${result}"`);
});

// Test invalid inputs
test('createOHLC with invalid timestamp', () => {
    const data = [{timestamp: "invalid", price_cny: 500.0, usd_cny_rate: 7.0}];
    const result = createOHLC(data);
    assert(result.length === 0, 'Should filter out invalid timestamps');
});

test('createOHLC with invalid price', () => {
    const data = [{timestamp: "2021-12-31T14:30:00+08:00", price_cny: "invalid", usd_cny_rate: 7.0}];
    const result = createOHLC(data);
    assert(result.length === 0, 'Should filter out invalid prices');
});

console.log('All JavaScript tests passed! ✨');
