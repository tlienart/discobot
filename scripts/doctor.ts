import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "bun";
import chalk from "chalk";

async function check() {
	console.log(chalk.bold("🩺 Discord-OpenCode Bridge Doctor\n"));

	// 1. Sudo Check
	console.log("1. Checking sudo status...");
	const sudoCheck = spawnSync(["sudo", "-n", "true"]);
	if (sudoCheck.exitCode !== 0) {
		console.log(
			chalk.yellow('⚠️  Sudo is not cached. Please run "sudo -v" first.'),
		);
	} else {
		console.log(chalk.green("✅ Sudo is cached."));
	}

	// 2. Full Disk Access Check
	console.log("\n2. Checking Full Disk Access...");
	try {
		const fdaCheck = spawnSync([
			"ls",
			"/Library/Application Support/com.apple.TCC",
		]);
		if (fdaCheck.exitCode === 0) {
			console.log(chalk.green("✅ Full Disk Access granted."));
		} else {
			console.log(
				chalk.red("❌ Full Disk Access NOT granted. Sbx creation will fail."),
			);
			console.log(
				chalk.dim(
					"   Go to System Settings > Privacy & Security > Full Disk Access and add your terminal.",
				),
			);
		}
	} catch {
		console.log(chalk.red("❌ FDA check failed."));
	}

	// 3. Sbx Installation Check
	console.log("\n3. Checking sbx installation...");
	const sbxBin = join(process.cwd(), "sbx", "bin", "sbx");
	if (!existsSync(sbxBin)) {
		console.log(
			chalk.red(
				'❌ sbx binary not found. Please run "git clone https://github.com/tlienart/sbx.git sbx".',
			),
		);
	} else {
		const sbxList = spawnSync([sbxBin, "list"]);
		if (sbxList.exitCode === 0) {
			console.log(chalk.green("✅ sbx is functional."));
		} else {
			console.log(chalk.red("❌ sbx found but not working correctly."));
			console.log(chalk.dim(sbxList.stderr.toString()));
		}
	}

	// 4. Config Check
	console.log("\n4. Checking config.json...");
	if (!existsSync("config.json")) {
		console.log(chalk.red("❌ config.json missing."));
	} else {
		try {
			const config = JSON.parse(readFileSync("config.json", "utf-8"));
			if (
				config.discord?.token &&
				config.discord?.clientId &&
				config.discord?.guildId
			) {
				console.log(chalk.green("✅ config.json is valid."));
			} else {
				console.log(
					chalk.yellow("⚠️  config.json is missing required discord fields."),
				);
			}
		} catch (e) {
			console.log(chalk.red(`❌ config.json is invalid JSON: ${e}`));
		}
	}

	// 5. Environment Variables Check
	console.log("\n5. Checking environment variables...");
	const envVars = [
		"SBX_GITHUB_TOKEN",
		"SBX_GOOGLE_API_KEY",
		"SBX_OPENAI_API_KEY",
		"SBX_ANTHROPIC_API_KEY",
	];
	let missingVars = 0;
	for (const v of envVars) {
		if (!process.env[v]) {
			console.log(chalk.dim(`- ${v}: ${chalk.yellow("missing")}`));
			missingVars++;
		} else {
			console.log(chalk.dim(`- ${v}: ${chalk.green("set")}`));
		}
	}
	if (missingVars === envVars.length) {
		console.log(
			chalk.yellow(
				"⚠️  No SBX_ secrets found in environment. Agent tools may fail.",
			),
		);
	}

	// 6. Opencode Installation Check
	console.log("\n6. Checking opencode installation...");
	const ocCheck = spawnSync(["which", "opencode"]);
	if (ocCheck.exitCode === 0) {
		console.log(
			chalk.green(`✅ opencode found at ${ocCheck.stdout.toString().trim()}`),
		);
	} else {
		console.log(
			chalk.red(
				"❌ opencode not found in PATH. Ensure it is installed host-wide.",
			),
		);
	}

	// 7. Sandbox Loopback Test
	const isFull = process.argv.includes("--full");
	if (isFull) {
		console.log("\n7. Performing Sandbox Loopback Test...");
		const testSbx = "doctor-test";

		if (existsSync(sbxBin)) {
			try {
				console.log(
					chalk.dim(`   - (Re)creating temporary sandbox "${testSbx}"...`),
				);
				spawnSync([sbxBin, "delete", testSbx]);
				const createResult = spawnSync([
					sbxBin,
					"create",
					testSbx,
					"--tools",
					"opencode",
				]);
				if (createResult.exitCode !== 0) {
					throw new Error(
						`Failed to create sandbox: ${createResult.stderr.toString()}`,
					);
				}

				console.log(
					chalk.dim('   - Executing "opencode --version" inside sandbox...'),
				);
				const execResult = spawnSync([
					sbxBin,
					"exec",
					testSbx,
					"--",
					"opencode",
					"--version",
				]);
				if (execResult.exitCode === 0) {
					console.log(chalk.green("✅ Basic loopback successful."));
				} else {
					console.log(
						chalk.red(
							`❌ Basic loopback failed (Exit Code ${execResult.exitCode}).`,
						),
					);
					console.log(
						chalk.dim(
							execResult.stderr.toString() || execResult.stdout.toString(),
						),
					);
				}

				console.log(
					chalk.dim(
						"   - Stress testing quoting with \"opencode run 'hello world'\"...",
					),
				);
				const stressResult = spawnSync([
					sbxBin,
					"exec",
					testSbx,
					"--",
					"opencode",
					"run",
					"--format",
					"json",
					'echo "nested quotes test"',
				]);
				if (stressResult.exitCode === 0) {
					console.log(chalk.green("✅ Quoting stress test successful."));
				} else {
					console.log(
						chalk.red(
							`❌ Quoting stress test failed (Exit Code ${stressResult.exitCode}).`,
						),
					);
					console.log(
						chalk.dim(
							stressResult.stderr.toString() || stressResult.stdout.toString(),
						),
					);
				}
			} catch (e) {
				console.log(chalk.red(`❌ Loopback test failed: ${e}`));
			} finally {
				console.log(
					chalk.dim(`   - Deleting temporary sandbox "${testSbx}"...`),
				);
				spawnSync([sbxBin, "delete", testSbx]);
			}
		} else {
			console.log(chalk.yellow("⚠️  Skipping loopback test (sbx not found)."));
		}
	} else {
		console.log("\n7. Sandbox Loopback Test");
		console.log(
			chalk.dim(
				'   - Skipped. Run "make doctor-full" for a complete loopback test.',
			),
		);
	}

	console.log(`\n${chalk.bold("Diagnosis Complete.")}`);
}

check();
