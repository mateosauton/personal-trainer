/**
 * Drives the app in a phone-sized Chromium and writes screenshots.
 *
 *   node drive.mjs <scenario> <outDir> [baseUrl]
 *
 * Scenarios are small named flows; each returns after writing its shots.
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const scenario = process.argv[2] ?? 'signin';
const outDir = process.argv[3] ?? './shots';
const base = process.argv[4] ?? 'http://localhost:8081';

mkdirSync(outDir, { recursive: true });

const ACCOUNTS = {
  onboarded: { email: 'demo@officegym.test', password: 'demo1234' },
  fresh: { email: 'fresh@officegym.test', password: 'demo1234' },
};


async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    // The container's egress proxy would swallow requests to the local mock.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
    env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' },
  });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  let n = 0;
  const shot = async (name) => {
    n += 1;
    const file = `${outDir}/${String(n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: file });
    console.log(`shot ${file}`);
  };

  const tap = async (text, { exact = false, nth = 0 } = {}) => {
    const loc = page.getByText(text, { exact }).nth(nth);
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    await loc.click();
  };

  const signIn = async (who = 'onboarded') => {
    const { email, password } = ACCOUNTS[who];
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill(password);
    await tap('Sign in', { exact: true });
    await page.waitForTimeout(2500);
  };

  /** The dev error overlay swallows every tap; take a shot, then clear it. */
  const dismissOverlay = async (label) => {
    const dismiss = page.getByText('Dismiss', { exact: true });
    if (await dismiss.count()) {
      if (label) await shot(label);
      await dismiss.first().click();
      await page.waitForTimeout(400);
      return true;
    }
    return false;
  };

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000); // metro's first bundle
  if (await dismissOverlay('root-error')) {
    // "/" is ambiguous between the tab and onboarding groups; go to the real
    // sign-in route so the rest of the flow can be exercised.
    await page.goto(`${base}/sign-in`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await dismissOverlay();
  }

  const flows = {
    // --- auth -----------------------------------------------------------
    async signin() {
      await shot('sign-in');
      await tap('No account? Sign up');
      await page.waitForTimeout(600);
      await shot('sign-up-mode');
      // With the keyboard-less web build the whole form is visible; on a phone
      // the interesting question is what sits below the primary button.
      await page.getByPlaceholder('Email').fill('brand.new@officegym.test');
      await page.getByPlaceholder('Password').fill('demo1234');
      await shot('sign-up-filled');
    },

    // --- onboarding -----------------------------------------------------
    async onboarding() {
      await signIn('fresh');
      await shot('onboarding-step-1');
      for (let i = 0; i < 8; i += 1) {
        const label = await page.getByText(/Step \d of \d/).first().textContent().catch(() => null);
        await shot(`onboarding-${(label ?? `step-${i}`).toLowerCase().replace(/\s+/g, '-')}`);
        const cont = page.getByText('Continue', { exact: true });
        if (await cont.count()) {
          await cont.first().click();
          await page.waitForTimeout(700);
          continue;
        }
        const build = page.getByText('Build my plan', { exact: true });
        if (await build.count()) {
          await build.first().click();
          await page.waitForTimeout(300);
          await shot('building-plan');
          await page.waitForTimeout(4000);
          await shot('after-build');
        }
        break;
      }
    },

    // --- post-login -----------------------------------------------------
    async today() {
      await signIn('onboarded');
      await shot('today');
      await page.waitForTimeout(2000);
      await shot('today-settled');
    },

    // --- session run ----------------------------------------------------
    async session() {
      await signIn('onboarded');
      await page.waitForTimeout(1500);
      await tap('Start session');
      await page.waitForTimeout(2500);
      await shot('session-overview');
      await tap('Begin');
      await page.waitForTimeout(3000);
      await shot('warmup');
      await tap('Done', { exact: true });
      await page.waitForTimeout(1200);
      await shot('first-work-set');
      await tap('Complete set');
      await page.waitForTimeout(1200);
      await shot('after-complete-set');
      const log = page.getByText('Log set', { exact: true });
      if (await log.count()) {
        await log.first().click();
        await page.waitForTimeout(1500);
        await shot('after-log-set');
      }
      await page.waitForTimeout(1500);
      await shot('resting');
    },
  };

  const flow = flows[scenario];
  if (!flow) throw new Error(`unknown scenario: ${scenario}`);
  await flow();

  if (errors.length) {
    console.log('\nconsole errors:');
    for (const e of [...new Set(errors)]) console.log(' -', e.slice(0, 400));
  } else {
    console.log('\nno console errors');
  }

  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
