// shared test setup: every tick() in a test syncs learnings into temp folders, never ~/.claude/skills or the live Ad Studio clone
import path from 'node:path';

/** temp skills + Ad Studio dirs next to a test home (so tests that list the home dir stay exact); created by the sync only
 *  when it writes. Spread into tick({ ..., ...brainDirs(home) }) or use as VIDEO_BRAIN_SKILLS_DIR / AD_STUDIO_ROOT for a spawned brain. */
export const brainDirs = (home) => ({ skillsDir: path.join(`${home}.brain`, 'skills'), adStudioRoot: path.join(`${home}.brain`, 'ad') });
