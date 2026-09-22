-- METRON · seed catalogue. No prices or headlines are seeded: the refresh function fills them from providers.

insert into instruments (sym, name, asset_class, region, currency, calendar, unit, provider, provider_symbol, tape_order) values
  ('SPX',      'S&P 500',                 'EQUITIES',    'US',     'USD', 'us',     '',  'twelvedata', 'SPX',      1),
  ('NDX/IXIC', 'Nasdaq Composite',        'EQUITIES',    'US',     'USD', 'us',     '',  'twelvedata', 'IXIC',     2),
  ('DJI',      'Dow Jones Industrial',    'EQUITIES',    'US',     'USD', 'us',     '',  'twelvedata', 'DJI',      null),
  ('RUT',      'Russell 2000',            'EQUITIES',    'US',     'USD', 'us',     '',  'twelvedata', 'RUT',      null),
  ('STOXX600', 'STOXX 600',               'EQUITIES',    'EUROPE', 'EUR', 'eu',     '',  'none',       null,       3),
  ('NKY',      'Nikkei 225',              'EQUITIES',    'JAPAN',  'JPY', 'asia',   '',  'twelvedata', 'N225',     4),
  ('HSI',      'Hang Seng',               'EQUITIES',    'CHINA',  'HKD', 'asia',   '',  'twelvedata', 'HSI',      5),
  ('ADX',      'Abu Dhabi (FADGI)',       'EQUITIES',    'UAE',    'AED', 'gcc',    '',  'exchange',   'FADGI',    6),
  ('DFMGI',    'Dubai (DFMGI)',           'EQUITIES',    'UAE',    'AED', 'gcc',    '',  'exchange',   'DFMGI',    7),
  ('TASI',     'Saudi (TASI)',            'EQUITIES',    'SAUDI',  'SAR', 'sunthu', '',  'exchange',   'TASI',     8),
  ('VIX',      'CBOE VIX',                'VOLATILITY',  'US',     'USD', 'us',     '',  'fred',       'VIXCLS',   null),
  ('US2Y',     'US 2Y Treasury',          'RATES',       'US',     'USD', 'us',     '%', 'treasury',   'BC_2YEAR', 9),
  ('US5Y',     'US 5Y Treasury',          'RATES',       'US',     'USD', 'us',     '%', 'treasury',   'BC_5YEAR', null),
  ('US10Y',    'US 10Y Treasury',         'RATES',       'US',     'USD', 'us',     '%', 'treasury',   'BC_10YEAR',10),
  ('US30Y',    'US 30Y Treasury',         'RATES',       'US',     'USD', 'us',     '%', 'treasury',   'BC_30YEAR',null),
  ('US10Y_REAL','US 10Y real yield (TIPS)','RATES',      'US',     'USD', 'us',     '%', 'fred',       'DFII10',   null),
  ('IG_OAS',   'US IG credit spread',     'CREDIT',      'US',     'USD', 'us',     '%', 'fred',       'BAMLC0A0CM', null),
  ('HY_OAS',   'US HY credit spread',     'CREDIT',      'US',     'USD', 'us',     '%', 'fred',       'BAMLH0A0HYM2', null),
  ('DXY',      'US dollar index',         'FX',          'GLOBAL', 'USD', 'us',     '',  'twelvedata', 'DXY',      11),
  ('EUR/USD',  'EUR/USD',                 'FX',          'EUROPE', 'USD', 'eu',     '',  'twelvedata', 'EUR/USD',  12),
  ('USD/JPY',  'USD/JPY',                 'FX',          'JAPAN',  'JPY', 'us',     '',  'twelvedata', 'USD/JPY',  13),
  ('GBP/USD',  'GBP/USD',                 'FX',          'UK',     'USD', 'eu',     '',  'twelvedata', 'GBP/USD',  14),
  ('USD/CHF',  'USD/CHF',                 'FX',          'EUROPE', 'CHF', 'eu',     '',  'twelvedata', 'USD/CHF',  null),
  ('USD/CNY',  'USD/CNY',                 'FX',          'CHINA',  'CNY', 'asia',   '',  'twelvedata', 'USD/CNY',  null),
  ('USD/AED',  'USD/AED (pegged)',        'FX',          'UAE',    'AED', 'gcc',    '',  'none',       null,       null),
  ('BRENT',    'Brent crude',             'COMMODITIES', 'GLOBAL', 'USD', 'us',     '$', 'fred',       'DCOILBRENTEU', 15),
  ('WTI',      'WTI crude',               'COMMODITIES', 'US',     'USD', 'us',     '$', 'fred',       'DCOILWTICO', 16),
  ('GOLD',     'Gold',                    'COMMODITIES', 'GLOBAL', 'USD', 'us',     '$', 'twelvedata', 'XAU/USD',  17),
  ('SILVER',   'Silver',                  'COMMODITIES', 'GLOBAL', 'USD', 'us',     '$', 'twelvedata', 'XAG/USD',  18),
  ('COPPER',   'Copper',                  'COMMODITIES', 'GLOBAL', 'USD', 'us',     '$', 'none',       null,       19),
  ('NATGAS',   'Natural gas (Henry Hub)', 'COMMODITIES', 'US',     'USD', 'us',     '$', 'fred',       'DHHNGSP',  null),
  ('BTC',      'Bitcoin',                 'CRYPTO',      'GLOBAL', 'USD', 'crypto', '$', 'twelvedata', 'BTC/USD',  20)
on conflict (sym) do update set name = excluded.name, provider = excluded.provider, provider_symbol = excluded.provider_symbol, tape_order = excluded.tape_order;

-- Providers and their configuration (never secrets). Feed URLs are configuration: edit here if a publisher moves a feed.
insert into providers (id, name, domain, status, config) values
  ('treasury',   'US Treasury daily par yield curve', 'RATES',   'NOT CONNECTED', '{"url":"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month={YYYYMM}"}'),
  ('fred',       'FRED (St. Louis Fed)',              'MACRO',   'KEY MISSING',   '{"url":"https://api.stlouisfed.org/fred/series/observations"}'),
  ('twelvedata', 'Twelve Data (free tier)',           'MARKET',  'KEY MISSING',   '{"url":"https://api.twelvedata.com","note":"free tier: check index and commodity coverage; unavailable symbols simply stay UNAVAILABLE"}'),
  ('exchange',   'GCC exchange feeds (ADX, DFM, Tadawul)', 'GCC', 'NOT CONNECTED', '{"note":"licensed feeds; rows stay UNAVAILABLE until connected"}'),
  ('rss',        'Official RSS wires',                'NEWS',    'NOT CONNECTED', '{"feeds":[{"id":"FED","url":"https://www.federalreserve.gov/feeds/press_all.xml","region":"US"},{"id":"ECB","url":"https://www.ecb.europa.eu/rss/press.html","region":"EUROPE"},{"id":"BOE","url":"https://www.bankofengland.co.uk/rss/news","region":"UK"},{"id":"BOJ","url":"https://www.boj.or.jp/en/rss/whatsnew.xml","region":"JAPAN"},{"id":"UST","url":"https://home.treasury.gov/news/press-releases/rss","region":"US"}],"note":"verify each URL once in a browser; a feed that fails is logged, never faked"}'),
  ('anthropic',  'Anthropic Claude API (server side)', 'AI',     'KEY MISSING',   '{"note":"used only by /api/ask and brief generation; never in the browser"}')
on conflict (id) do update set config = excluded.config;

-- Central banks: names only. Rates and tone are filled by the refresh function from wires, or left UNAVAILABLE.
insert into central_banks (code, name, tone) values
  ('FED',   'Federal Reserve', 'UNAVAILABLE'), ('ECB', 'European Central Bank', 'UNAVAILABLE'), ('BOE', 'Bank of England', 'UNAVAILABLE'),
  ('BOJ',   'Bank of Japan', 'UNAVAILABLE'),   ('CBUAE', 'Central Bank of the UAE', 'UNAVAILABLE'), ('SAMA', 'Saudi Central Bank', 'UNAVAILABLE')
on conflict (code) do nothing;
