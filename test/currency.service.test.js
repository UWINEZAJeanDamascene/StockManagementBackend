const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const CurrencyService = require('../services/CurrencyService');
const Company = require('../models/Company');
const ExchangeRate = require('../models/ExchangeRate');
const Currency = require('../models/Currency');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await ExchangeRate.deleteMany({});
  await Currency.deleteMany({});
  await Company.deleteMany({});
});

describe('CurrencyService', () => {
  let companyRwf;
  let companyUsd;

  beforeEach(async () => {
    companyRwf = await Company.create({
      name: 'Co RWF',
      code: 'CRWF',
      email: 'r@test.com',
      base_currency: 'RWF'
    });
    companyUsd = await Company.create({
      name: 'Co USD',
      code: 'CUSD',
      email: 'u@test.com',
      base_currency: 'USD'
    });
  });

  it('getRate returns 1 when from and to currency are the same', async () => {
    const rate = await CurrencyService.getRate(
      companyRwf._id.toString(),
      'RWF',
      'RWF',
      new Date()
    );
    expect(rate).toBe(1);
  });

  it('getRate returns most recent rate on or before asOfDate', async () => {
    const jan1 = new Date(Date.UTC(2025, 0, 1));
    const jan15 = new Date(Date.UTC(2025, 0, 15));
    const feb1 = new Date(Date.UTC(2025, 1, 1));

    await ExchangeRate.create({
      company_id: companyRwf._id,
      from_currency: 'USD',
      to_currency: 'RWF',
      rate: 1200,
      effective_date: jan1,
      source: 'manual'
    });
    await ExchangeRate.create({
      company_id: companyRwf._id,
      from_currency: 'USD',
      to_currency: 'RWF',
      rate: 1250,
      effective_date: jan15,
      source: 'manual'
    });

    const rateBefore = await CurrencyService.getRate(
      companyRwf._id.toString(),
      'USD',
      'RWF',
      new Date(Date.UTC(2025, 0, 10))
    );
    expect(rateBefore).toBe(1200);

    const rateOn = await CurrencyService.getRate(
      companyRwf._id.toString(),
      'USD',
      'RWF',
      jan15
    );
    expect(rateOn).toBe(1250);

    const rateAfter = await CurrencyService.getRate(
      companyRwf._id.toString(),
      'USD',
      'RWF',
      feb1
    );
    expect(rateAfter).toBe(1250);
  });

  it('getRate throws EXCHANGE_RATE_NOT_FOUND when no rate exists', async () => {
    await expect(
      CurrencyService.getRate(
        companyRwf._id.toString(),
        'EUR',
        'RWF',
        new Date()
      )
    ).rejects.toThrow('EXCHANGE_RATE_NOT_FOUND');
  });

  it('convert multiplies amount by rate and rounds to 2 decimal places', async () => {
    await ExchangeRate.create({
      company_id: companyRwf._id,
      from_currency: 'USD',
      to_currency: 'RWF',
      rate: 1285.5,
      effective_date: new Date(),
      source: 'manual'
    });

    const converted = await CurrencyService.convert(
      companyRwf._id.toString(),
      100,
      'USD',
      new Date()
    );
    expect(converted).toBe(128550); // 100 * 1285.5
  });

  it('convert returns original amount when currency equals base currency', async () => {
    const amount = 5000;
    const result = await CurrencyService.convert(
      companyRwf._id.toString(),
      amount,
      'RWF',
      new Date()
    );
    expect(result).toBe(amount);
  });

  it('rate lookup scoped to company', async () => {
    await ExchangeRate.create({
      company_id: companyRwf._id,
      from_currency: 'USD',
      to_currency: 'RWF',
      rate: 1300,
      effective_date: new Date(),
      source: 'manual'
    });
    await ExchangeRate.create({
      company_id: companyUsd._id,
      from_currency: 'RWF',
      to_currency: 'USD',
      rate: 0.00077,
      effective_date: new Date(),
      source: 'manual'
    });

    const rateRwf = await CurrencyService.getRate(
      companyRwf._id.toString(),
      'USD',
      'RWF',
      new Date()
    );
    expect(rateRwf).toBe(1300);

    const rateUsd = await CurrencyService.getRate(
      companyUsd._id.toString(),
      'RWF',
      'USD',
      new Date()
    );
    expect(rateUsd).toBe(0.00077);
  });

  it('adding a rate with earlier date does not override more recent rate', async () => {
    const user = { _id: new mongoose.Types.ObjectId() };
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    await CurrencyService.addRate(
      companyRwf._id.toString(),
      { from_currency: 'USD', rate: 1200, effective_date: yesterday },
      user._id
    );
    await CurrencyService.addRate(
      companyRwf._id.toString(),
      { from_currency: 'USD', rate: 1300, effective_date: today },
      user._id
    );

    const rateNow = await CurrencyService.getRate(
      companyRwf._id.toString(),
      'USD',
      'RWF',
      new Date(today.getTime() + 1000)
    );
    expect(rateNow).toBe(1300);

    const ratePast = await CurrencyService.getRate(
      companyRwf._id.toString(),
      'USD',
      'RWF',
      yesterday
    );
    expect(ratePast).toBe(1200);
  });

  it('seedCurrencies upserts standard currencies', async () => {
    await CurrencyService.seedCurrencies();

    const rwf = await Currency.findOne({ code: 'RWF' }).lean();
    expect(rwf).toBeDefined();
    expect(rwf.name).toBe('Rwandan Franc');
    expect(rwf.symbol).toBe('FRw');
    expect(rwf.decimal_places).toBe(0);

    const usd = await Currency.findOne({ code: 'USD' }).lean();
    expect(usd).toBeDefined();
    expect(usd.name).toBe('US Dollar');
  });
});
