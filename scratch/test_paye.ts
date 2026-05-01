function calculatePAYE(taxableIncome: number, tiers: any[]) {
  let tax = 0;
  let remainingIncome = taxableIncome;
  let previousThreshold = 0;

  for (const tier of tiers) {
    const tierSize = tier.threshold - previousThreshold;
    const taxableInThisTier = Math.min(Math.max(remainingIncome, 0), tierSize);
    tax += taxableInThisTier * (tier.rate / 100);
    remainingIncome -= taxableInThisTier;
    previousThreshold = tier.threshold;
    if (remainingIncome <= 0) break;
  }
  
  if (remainingIncome > 0 && tiers.length > 0) {
    const lastRate = tiers[tiers.length - 1].rate;
    tax += remainingIncome * (lastRate / 100);
  }

  return tax;
}

const graTiers = [
  { threshold: 402, rate: 0 },
  { threshold: 110 + 402, rate: 5 },
  { threshold: 130 + 512, rate: 10 },
  { threshold: 3000 + 642, rate: 17.5 },
  { threshold: 16395 + 3642, rate: 25 },
  { threshold: 20000 + 20037, rate: 30 },
  { threshold: 999999, rate: 35 }
];

// Test cases
console.log("Income: 400, Tax:", calculatePAYE(400, graTiers));
console.log("Income: 500, Tax:", calculatePAYE(500, graTiers));
console.log("Income: 1000, Tax:", calculatePAYE(1000, graTiers));
console.log("Income: 5000, Tax:", calculatePAYE(5000, graTiers));
