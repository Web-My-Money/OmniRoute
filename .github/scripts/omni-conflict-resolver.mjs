import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MODEL_CASCADE = [
  process.env.OMNIROUTER_MODEL,
  'GdogCode',
  'GdogReloaded',
  'GdogHeavy',
  'anthropic/claude-3.5-haiku',
].filter(Boolean);

async function callLLM(baseUrl, apiKey, prompt) {
  for (const model of MODEL_CASCADE) {
    try {
      console.log(`  Attempting resolution using model: ${model}...`);
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        console.warn(`  Model ${model} returned ${response.status} ${response.statusText}. Trying next model...`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (content && content.trim().length > 0) {
        return content;
      }
    } catch (err) {
      console.warn(`  Error calling ${model}: ${err.message}. Trying next model...`);
    }
  }
  return null;
}

async function main() {
  console.log('Searching for files with git conflict markers (including 2-way and 3-way markers)...');
  
  let unmergedFiles = [];
  try {
    const statusOutput = execSync('git status --porcelain', { encoding: 'utf-8' });
    const lines = statusOutput.split('\n');
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const filePath = line.slice(3).trim();
      if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.includes('<<<<<<<') && content.includes('>>>>>>>')) {
          unmergedFiles.push(filePath);
        }
      }
    }
  } catch (err) {
    console.error('Error getting git status:', err.message);
  }

  if (unmergedFiles.length === 0) {
    console.log('No conflict markers found in changed files.');
    process.exit(0);
  }

  console.log(`Found ${unmergedFiles.length} file(s) with conflict markers:`, unmergedFiles);

  // Read local conventions
  let conventions = '';
  for (const filename of ['AGENTS.md', 'CLAUDE.md', 'web/AGENTS.md', 'web/CLAUDE.md']) {
    if (fs.existsSync(filename)) {
      conventions += `\n--- Conventions from ${filename} ---\n` + fs.readFileSync(filename, 'utf-8');
    }
  }

  const apiKey = process.env.OMNIROUTER_API_KEY || process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('No OmniRoute or LLM API key provided in environment. Skipping script resolution step.');
    process.exit(0);
  }

  const baseUrl = process.env.OMNIROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

  let resolvedCount = 0;
  for (const filePath of unmergedFiles) {
    console.log(`Resolving conflict in: ${filePath}...`);
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    const prompt = `You are an expert AI software engineer resolving a git merge conflict.
Below is the conflicting file '${filePath}' containing git conflict markers (<<<<<<<, =======, >>>>>>>, and optional ||||||| base).

Repository Conventions to respect:
${conventions || 'Follow TypeScript strict, Next.js App Router, npm only, and clean modular code.'}

File Content with Conflict Markers:
\`\`\`
${fileContent}
\`\`\`

Instructions:
1. Carefully analyze both sides of each conflict marker (and base section if present).
2. Combine features or preserve the intended logic from both branches seamlessly.
3. Remove ALL conflict markers (<<<<<<<, =======, >>>>>>>, |||||||).
4. Output ONLY the raw resolved file content. Do NOT wrap in markdown code blocks (\`\`\`), do NOT explain.`;

    const rawResponse = await callLLM(baseUrl, apiKey, prompt);

    if (!rawResponse) {
      console.error(`Failed to get AI resolution for ${filePath}`);
      continue;
    }

    let resolvedText = rawResponse;
    // Clean code block wrappers if added
    if (resolvedText.trim().startsWith('```')) {
      resolvedText = resolvedText.trim()
        .replace(/^```[a-zA-Z0-9_-]*\n/, '')
        .replace(/\n```$/, '');
    }

    // Verify no conflict markers remain
    if (resolvedText.includes('<<<<<<<') || resolvedText.includes('>>>>>>>') || resolvedText.includes('=======')) {
      console.error(`AI response for ${filePath} still contained conflict markers. Aborting file edit.`);
      continue;
    }

    // Security pre-check: verify no secret keys or private credentials leaked
    if (resolvedText.includes('-----BEGIN PRIVATE KEY-----') || /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(resolvedText)) {
      console.error(`SECURITY BLOCK: Potential secret key leak detected in resolved content for ${filePath}. Aborting edit.`);
      continue;
    }

    fs.writeFileSync(filePath, resolvedText, 'utf-8');
    execSync(`git add "${filePath}"`);
    console.log(`Successfully resolved and staged: ${filePath}`);
    resolvedCount++;
  }

  console.log(`OmniRoute conflict resolution step complete (${resolvedCount}/${unmergedFiles.length} files resolved).`);
}

main().catch(err => {
  console.error('Fatal error in conflict resolver:', err);
  process.exit(1);
});
