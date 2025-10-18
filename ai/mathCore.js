import * as math from 'mathjs';

export function compute(input) {
  try {
    return math.evaluate(input);
  } catch (err) {
    return null;
  }
}
