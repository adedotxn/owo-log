const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CLEAR  = '\r\x1b[2K';
const tty    = Boolean(process.stdout.isTTY);

// Colours are no-ops when not writing to a real terminal (e.g. piped output)
const raw = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[97m',
  grey:   '\x1b[90m',
};
const off = Object.fromEntries(Object.keys(raw).map((k) => [k, ''])) as typeof raw;
const c = tty ? raw : off;

class Spinner {
  private frame  = 0;
  private timer:  ReturnType<typeof setInterval> | null = null;
  private msg    = '';
  private hint   = '';

  start(msg: string): this {
    this.msg   = msg;
    this.hint  = '';
    this.frame = 0;
    if (tty) {
      this.timer = setInterval(() => this.tick(), 80);
      this.tick();
    } else {
      process.stdout.write(`  ${msg}...\n`);
    }
    return this;
  }

  progress(current: number, total: number): this {
    this.hint = `${c.dim}(${current}/${total})${c.reset}`;
    return this;
  }

  private tick(): void {
    const f = FRAMES[this.frame++ % FRAMES.length];
    process.stdout.write(`${CLEAR}  ${c.cyan}${f}${c.reset}  ${this.msg}  ${this.hint}`);
  }

  private clear(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (tty) process.stdout.write(CLEAR);
  }

  succeed(msg: string, ms?: number): void {
    this.clear();
    const t = ms !== undefined ? `  ${c.dim}${fmtMs(ms)}${c.reset}` : '';
    process.stdout.write(`  ${c.green}✓${c.reset}  ${msg}${t}\n`);
  }

  fail(msg: string): void {
    this.clear();
    process.stdout.write(`  ${c.red}✗${c.reset}  ${c.red}${msg}${c.reset}\n`);
  }

  warn(msg: string): void {
    this.clear();
    process.stdout.write(`  ${c.yellow}⚠${c.reset}  ${msg}\n`);
  }
}

export const spinner = new Spinner();

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function header(title: string): void {
  process.stdout.write(`\n${c.bold}${c.white}  ${title}${c.reset}\n\n`);
}

export function info(label: string, value?: string): void {
  const v = value ? `  ${c.cyan}${value}${c.reset}` : '';
  process.stdout.write(`  ${c.grey}${label}${c.reset}${v}\n`);
}

export function warn(msg: string): void {
  process.stdout.write(`  ${c.yellow}⚠${c.reset}  ${msg}\n`);
}

export function done(msg: string, ms: number): void {
  process.stdout.write(
    `\n  ${c.green}${c.bold}✓${c.reset}  ${c.bold}${msg}${c.reset}  ${c.dim}${fmtMs(ms)}${c.reset}\n\n`
  );
}
