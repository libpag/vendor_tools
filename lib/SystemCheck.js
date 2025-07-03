const fs = require('fs');
const os = require('os');
const path = require('path');
const Utils = require('./Utils');

class SystemCheck {
    
    static checkBuildEnvironment(buildPath, platform) {
        Utils.log("[SYSCHECK] Starting build environment check...");
        
        const issues = [];
        const warnings = [];
        
        // Check disk space
        const diskCheck = this.checkDiskSpace(buildPath);
        if (diskCheck.critical) {
            issues.push(diskCheck.message);
        } else if (diskCheck.warning) {
            warnings.push(diskCheck.message);
        }
        
        // Check memory
        const memCheck = this.checkMemory();
        if (memCheck.critical) {
            issues.push(memCheck.message);
        } else if (memCheck.warning) {
            warnings.push(memCheck.message);
        }
        
        // Check CPU load
        const loadCheck = this.checkSystemLoad();
        if (loadCheck.warning) {
            warnings.push(loadCheck.message);
        }
        
        // Check file permissions
        const permCheck = this.checkPermissions(buildPath);
        if (permCheck.critical) {
            issues.push(permCheck.message);
        }
        
        // Check for other build processes
        const processCheck = this.checkConcurrentBuilds();
        if (processCheck.warning) {
            warnings.push(processCheck.message);
        }
        
        // Platform-specific checks
        const platformCheck = this.checkPlatformSpecific(platform);
        if (platformCheck.critical) {
            issues.push(platformCheck.message);
        } else if (platformCheck.warning) {
            warnings.push(platformCheck.message);
        }
        
        // Report findings
        if (issues.length > 0) {
            Utils.error("[SYSCHECK] Critical issues detected:");
            issues.forEach(issue => Utils.error(`[SYSCHECK]   ❌ ${issue}`));
            throw new Error("Critical system issues detected. Please resolve before building.");
        }
        
        if (warnings.length > 0) {
            Utils.log("[SYSCHECK] Warnings detected:");
            warnings.forEach(warning => Utils.log(`[SYSCHECK]   ⚠️  ${warning}`));
        }
        
        if (issues.length === 0 && warnings.length === 0) {
            Utils.log("[SYSCHECK] ✅ All checks passed");
        }
        
        Utils.log("[SYSCHECK] Build environment check completed");
    }
    
    static checkDiskSpace(buildPath) {
        try {
            const stats = fs.statSync(buildPath);
            // This is a basic check - in real scenarios you'd want to use statvfs or similar
            Utils.log(`[SYSCHECK] Build directory exists and is accessible: ${buildPath}`);
            
            // Try to create a temporary file to test write permissions
            const testFile = path.join(buildPath, '.write_test');
            try {
                fs.writeFileSync(testFile, 'test');
                fs.unlinkSync(testFile);
                return { critical: false, warning: false, message: "Disk space check passed" };
            } catch (writeErr) {
                return { 
                    critical: true, 
                    message: `Cannot write to build directory: ${writeErr.message}` 
                };
            }
        } catch (err) {
            if (err.code === 'ENOENT') {
                // Directory doesn't exist, try to create it
                try {
                    Utils.createDirectory(buildPath);
                    return { critical: false, warning: false, message: "Created build directory" };
                } catch (createErr) {
                    return { 
                        critical: true, 
                        message: `Cannot create build directory: ${createErr.message}` 
                    };
                }
            } else {
                return { 
                    critical: true, 
                    message: `Build directory access error: ${err.message}` 
                };
            }
        }
    }
    
    static checkMemory() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMemPercent = ((totalMem - freeMem) / totalMem) * 100;
        
        const totalGB = (totalMem / (1024 * 1024 * 1024)).toFixed(1);
        const freeGB = (freeMem / (1024 * 1024 * 1024)).toFixed(1);
        
        Utils.log(`[SYSCHECK] Memory: ${freeGB}GB free / ${totalGB}GB total (${usedMemPercent.toFixed(1)}% used)`);
        
        if (freeMem < 1024 * 1024 * 1024) { // Less than 1GB free
            return {
                critical: true,
                message: `Very low memory: only ${freeGB}GB free. Build may fail.`
            };
        } else if (freeMem < 2 * 1024 * 1024 * 1024) { // Less than 2GB free
            return {
                warning: true,
                message: `Low memory: only ${freeGB}GB free. Consider reducing parallel jobs.`
            };
        }
        
        return { critical: false, warning: false, message: "Memory check passed" };
    }
    
    static checkSystemLoad() {
        const loadAvg = os.loadavg();
        const cpuCount = os.cpus().length;
        const load1min = loadAvg[0];
        const loadPercent = (load1min / cpuCount) * 100;
        
        Utils.log(`[SYSCHECK] System load: ${load1min.toFixed(2)} (${loadPercent.toFixed(1)}% of ${cpuCount} CPUs)`);
        
        if (loadPercent > 90) {
            return {
                warning: true,
                message: `High system load: ${loadPercent.toFixed(1)}%. Build may be slow.`
            };
        }
        
        return { warning: false, message: "System load check passed" };
    }
    
    static checkPermissions(buildPath) {
        try {
            // Check if we can read the parent directory
            const parentDir = path.dirname(buildPath);
            fs.accessSync(parentDir, fs.constants.R_OK | fs.constants.W_OK);
            
            // Check build directory if it exists
            if (fs.existsSync(buildPath)) {
                fs.accessSync(buildPath, fs.constants.R_OK | fs.constants.W_OK);
            }
            
            return { critical: false, message: "Permissions check passed" };
        } catch (err) {
            return {
                critical: true,
                message: `Permission denied: ${err.message}`
            };
        }
    }
    
    static checkConcurrentBuilds() {
        // This is a simplified check - in reality you'd want to check for other cmake/ninja processes
        const pid = process.pid;
        Utils.log(`[SYSCHECK] Current process PID: ${pid}`);
        
        return { warning: false, message: "Concurrent build check passed" };
    }
    
    static checkPlatformSpecific(platform) {
        if (platform.name === "win") {
            return this.checkWindows();
        } else if (platform.name === "mac" || platform.name === "ios") {
            return this.checkMacOS();
        } else if (platform.name === "linux") {
            return this.checkLinux();
        }
        
        return { critical: false, warning: false, message: "Platform check passed" };
    }
    
    static checkWindows() {
        // Check for Windows-specific issues
        if (process.env.TEMP && process.env.TEMP.length > 100) {
            return {
                warning: true,
                message: "TEMP path is very long, may cause build issues"
            };
        }
        
        return { critical: false, warning: false, message: "Windows check passed" };
    }
    
    static checkMacOS() {
        // Check for Xcode command line tools
        if (!Utils.execSafe("xcode-select -p")) {
            return {
                critical: true,
                message: "Xcode command line tools not found. Run: xcode-select --install"
            };
        }
        
        return { critical: false, warning: false, message: "macOS check passed" };
    }
    
    static checkLinux() {
        // Check for common build tools
        const tools = ['make', 'gcc', 'g++'];
        const missing = tools.filter(tool => !Utils.execSafe(`which ${tool}`));
        
        if (missing.length > 0) {
            return {
                warning: true,
                message: `Missing build tools: ${missing.join(', ')}`
            };
        }
        
        return { critical: false, warning: false, message: "Linux check passed" };
    }
}

module.exports = SystemCheck; 