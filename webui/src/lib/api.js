import { exec } from 'kernelsu-alt';
import { WXClass, WXEventHandler } from 'webuix';

if (typeof window !== 'undefined') {
	window.wx = new WXEventHandler();
}

class ChimeraWX extends WXClass {
	constructor() {
		super();
		this.fileToken = '$chimeraFile';
		this.moduleToken = '$chimera';
		if (typeof window !== 'undefined' && !window[this.fileToken] && window['$chimerafile']) {
			this.fileToken = '$chimerafile';
		}
		this.events = typeof window !== 'undefined' ? window.wx : null;
	}

	get files() {
		return (typeof window !== 'undefined' && this.fileToken) ? window[this.fileToken] : null;
	}

	async runCommand(cmd, cwd = null) {
		if (typeof window !== 'undefined' && !window.ksu && !window.$chimera) {
			console.log(`[Mock Exec] ${cmd}`);
            if (cmd.includes('cat') && cmd.includes('blocklist.conf')) return "# test_wake_1\ntest_wake_2";
            if (cmd.includes('cat') && cmd.includes('stats')) return "wlan_rx_wake | 5 | 2\ntest_wake_2 | 100 | 0";
            if (cmd.includes('setprop')) return "";
			return "Mock Output";
		}

		try {
			const { errno, stdout, stderr } = await exec(cmd, cwd ? { cwd } : {});
			return errno === 0 ? stdout.trim() : { error: stderr };
		} catch (e) {
			console.error("Command execution failed:", e);
			return { error: e.message };
		}
	}

	async fileExists(path) {
		if (this.files && typeof this.files.exists === 'function') return this.files.exists(path);
		const result = await this.runCommand(`[ -e "${path}" ] && echo 1 || echo 0`);
		return result === '1';
	}

	async readFile(path) {
		if (this.files && typeof this.files.read === 'function') return this.files.read(path);
		return await this.runCommand(`cat "${path}"`);
	}

	async writeFile(path, content) {
		if (this.files && typeof this.files.write === 'function') return this.files.write(path, content);
		return await this.runCommand(`echo "${content}" > "${path}"`);
	}
}

export const wx = new ChimeraWX();
export const runCommand = wx.runCommand.bind(wx);
export const fileExists = wx.fileExists.bind(wx);
export const readFile = wx.readFile.bind(wx);
export const writeFile = wx.writeFile.bind(wx);
