export function parseReleaseTime(input: string): number | null {
    const cleanedInput = input.trim().replace(",", ".");
  
    if (!cleanedInput) return null;
  
    const numericValue = Number(cleanedInput);
  
    if (Number.isNaN(numericValue)) return null;
  
    if (numericValue >= 100) {
      return numericValue / 100;
    }
  
    return numericValue;
  }
  
  export function formatReleaseTime(value: number): string {
    return `${value.toFixed(2)}s`;
  }