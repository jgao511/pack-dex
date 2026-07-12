export function calculateValueCoverage(items = [], getMarketPrice, threshold = 0) {
  return items.reduce((coverage, item) => {
    const marketPrice = Number(getMarketPrice(item));
    const count = Number(item.count || item.quantity || 1);
    const isPriced = Number.isFinite(marketPrice) && marketPrice > 0 && marketPrice >= threshold;

    coverage.totalCards += 1;
    if (isPriced) {
      coverage.pricedCards += 1;
      coverage.totalValue += marketPrice * count;
    }
    coverage.isComplete = coverage.pricedCards === coverage.totalCards;
    return coverage;
  }, { totalValue: 0, pricedCards: 0, totalCards: 0, isComplete: true });
}
