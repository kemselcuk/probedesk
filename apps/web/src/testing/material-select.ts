import { getDebugNode } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSelect } from '@angular/material/select';

export function materialSelect(root: HTMLElement, selector: string): MatSelect {
  const host = root.querySelector(selector);
  if (host === null) throw new Error(`Select not found: ${selector}`);
  return getDebugNode(host)?.componentInstance as MatSelect;
}

/** Interact through the real option DOM, including Material's disabled handling. */
export function selectValue(root: HTMLElement, selector: string, value: string): void {
  const select = materialSelect(root, selector);
  select.open();
  TestBed.tick();
  const option = select.options.find((candidate) => candidate.value === value);
  if (!option) throw new Error(`Option not found: ${value}`);
  document.getElementById(option.id)?.click();
}
