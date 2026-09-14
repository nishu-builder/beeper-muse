import type { Configuration } from '../browser-runtime/runtime/matrix.js';
export function readRegistration(input: string): Promise<Configuration>;
export function saveRegistration(input: string, output: string): Promise<void>;
