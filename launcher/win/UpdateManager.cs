using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace OcarinaAtlasLauncher
{
    internal sealed class UpdateInfo
    {
        public string DisplayTag = string.Empty;
        public string ReleaseName = string.Empty;
        public string ReleaseNotes = string.Empty;
        public string HtmlUrl = UpdateManager.DefaultReleaseFallbackUrl;
        public string ZipDownloadUrl = string.Empty;
        public string Sha256DownloadUrl = string.Empty;
        public string ExpectedSha256 = string.Empty;
        public bool RequireSha256 = false;
        public Version ParsedVersion;
    }

    internal static class UpdateManager
    {
        public const string OfficialRepoUrl = "https://github.com/antonioalvromero/Ocarina-Atlas";
        public const string OriginalRepoUrl = "https://github.com/lucasriondel/oot-remake-map";
        public const string DefaultReleaseApiUrl = "https://api.github.com/repos/antonioalvromero/Ocarina-Atlas/releases/latest";
        public const string DefaultReleaseFallbackUrl = OfficialRepoUrl + "/releases/latest";

        private const string OfficialGithubPathPrefix = "/antonioalvromero/Ocarina-Atlas";
        private const string OfficialApiPathPrefix = "/repos/antonioalvromero/Ocarina-Atlas";
        private static readonly Regex Sha256TokenRegex = new Regex(@"\b([0-9a-fA-F]{64})\b", RegexOptions.Compiled);

        public static string ResolveFeedUrl(string overrideUrl)
        {
            if (!string.IsNullOrEmpty(overrideUrl) && IsAllowedUpdateFeedUrl(overrideUrl))
            {
                return overrideUrl.Trim();
            }
            return DefaultReleaseApiUrl;
        }

        public static bool IsLoopbackUrl(string rawUrl)
        {
            if (string.IsNullOrEmpty(rawUrl)) return false;
            Uri uri;
            if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out uri)) return false;
            return IsLoopbackUri(uri);
        }

        private static bool IsLoopbackUri(Uri uri)
        {
            if (uri == null) return false;
            if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            string host = uri.Host ?? string.Empty;
            return string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase);
        }

        private static bool HasExactPathOrPrefix(string absolutePath, string prefix)
        {
            if (string.IsNullOrEmpty(absolutePath) || string.IsNullOrEmpty(prefix)) return false;
            if (absolutePath.IndexOf("..", StringComparison.Ordinal) >= 0) return false;
            return string.Equals(absolutePath, prefix, StringComparison.OrdinalIgnoreCase) ||
                   absolutePath.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsOfficialRepoUri(Uri uri)
        {
            if (uri == null || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            if (!string.IsNullOrEmpty(uri.UserInfo)) return false;

            string host = uri.Host ?? string.Empty;
            string path = uri.AbsolutePath ?? string.Empty;

            if (string.Equals(host, "github.com", StringComparison.OrdinalIgnoreCase))
            {
                return HasExactPathOrPrefix(path, OfficialGithubPathPrefix);
            }
            if (string.Equals(host, "api.github.com", StringComparison.OrdinalIgnoreCase))
            {
                return HasExactPathOrPrefix(path, OfficialApiPathPrefix);
            }
            return false;
        }

        private static bool IsAllowedGitHubUri(Uri uri)
        {
            if (uri == null || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            if (!string.IsNullOrEmpty(uri.UserInfo)) return false;

            string host = uri.Host ?? string.Empty;
            return string.Equals(host, "github.com", StringComparison.OrdinalIgnoreCase) ||
                   host.EndsWith(".github.com", StringComparison.OrdinalIgnoreCase) ||
                   host.EndsWith(".githubusercontent.com", StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsAllowedUpdateFeedUrl(string rawUrl)
        {
            if (string.IsNullOrEmpty(rawUrl)) return false;
            Uri uri;
            if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out uri)) return false;
            return IsLoopbackUri(uri) || IsAllowedGitHubUri(uri);
        }

        public static bool IsAllowedUpdateUrl(string rawUrl)
        {
            if (string.IsNullOrEmpty(rawUrl)) return false;
            Uri uri;
            if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out uri)) return false;
            return IsLoopbackUri(uri) || IsAllowedGitHubUri(uri);
        }

        public static bool IsAllowedRedirectUri(Uri initialUri, Uri finalUri)
        {
            if (finalUri == null) return false;
            if (IsAllowedGitHubUri(finalUri)) return true;
            return initialUri != null && IsLoopbackUri(initialUri) && IsLoopbackUri(finalUri);
        }

        public static void ExtractZipSafely(string zipPath, string extractDir)
        {
            if (string.IsNullOrEmpty(zipPath))
            {
                throw new ArgumentException("ZIP path is required.", "zipPath");
            }
            if (string.IsNullOrEmpty(extractDir))
            {
                throw new ArgumentException("Extract directory is required.", "extractDir");
            }

            string fullExtractDir = Path.GetFullPath(extractDir).TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar);
            Directory.CreateDirectory(fullExtractDir);
            string fullExtractDirWithSep = fullExtractDir + Path.DirectorySeparatorChar;

            MethodInfo openReadMethod = typeof(ZipFile).GetMethod("OpenRead", new Type[] { typeof(string) });
            if (openReadMethod == null)
            {
                throw new InvalidOperationException("ZipFile.OpenRead is unavailable in this runtime.");
            }

            using (IDisposable archive = (IDisposable)openReadMethod.Invoke(null, new object[] { zipPath }))
            {
                if (archive == null)
                {
                    throw new InvalidDataException("Failed to open update ZIP archive.");
                }

                PropertyInfo entriesProp = archive.GetType().GetProperty("Entries");
                System.Collections.IEnumerable entries = entriesProp != null
                    ? (System.Collections.IEnumerable)entriesProp.GetValue(archive, null)
                    : null;
                if (entries == null)
                {
                    throw new InvalidDataException("Update ZIP archive has no readable entries.");
                }

                PropertyInfo fullNameProp = null;
                PropertyInfo nameProp = null;
                MethodInfo openEntryMethod = null;

                foreach (object entry in entries)
                {
                    if (entry == null)
                    {
                        continue;
                    }
                    if (fullNameProp == null)
                    {
                        Type entryType = entry.GetType();
                        fullNameProp = entryType.GetProperty("FullName");
                        nameProp = entryType.GetProperty("Name");
                        openEntryMethod = entryType.GetMethod("Open", Type.EmptyTypes);
                    }

                    string fullName = fullNameProp != null ? (string)fullNameProp.GetValue(entry, null) : null;
                    string name = nameProp != null ? (string)nameProp.GetValue(entry, null) : null;
                    if (string.IsNullOrEmpty(fullName))
                    {
                        continue;
                    }

                    string destinationPath = Path.GetFullPath(Path.Combine(fullExtractDir, fullName));
                    bool isRootDirEntry =
                        string.IsNullOrEmpty(name) &&
                        string.Equals(
                            destinationPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                            fullExtractDir,
                            StringComparison.OrdinalIgnoreCase);

                    if (!isRootDirEntry &&
                        !destinationPath.StartsWith(fullExtractDirWithSep, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException("Blocked unsafe ZIP entry path: " + fullName);
                    }

                    if (string.IsNullOrEmpty(name) ||
                        fullName.EndsWith("/", StringComparison.Ordinal) ||
                        fullName.EndsWith("\\", StringComparison.Ordinal))
                    {
                        Directory.CreateDirectory(destinationPath);
                        continue;
                    }

                    string parentDir = Path.GetDirectoryName(destinationPath);
                    if (!string.IsNullOrEmpty(parentDir))
                    {
                        Directory.CreateDirectory(parentDir);
                    }

                    if (openEntryMethod == null)
                    {
                        throw new InvalidOperationException("ZipArchiveEntry.Open is unavailable in this runtime.");
                    }
                    using (Stream entryStream = (Stream)openEntryMethod.Invoke(entry, null))
                    using (FileStream outputStream = new FileStream(destinationPath, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        entryStream.CopyTo(outputStream);
                    }
                }
            }
        }

        public static string ParseSha256DigestText(string content)
        {
            if (string.IsNullOrEmpty(content)) return string.Empty;
            string[] lines = content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                string trimmed = lines[i].Trim();
                if (trimmed.Length == 0) continue;
                Match match = Sha256TokenRegex.Match(trimmed);
                if (match.Success)
                {
                    return match.Groups[1].Value.ToLowerInvariant();
                }
            }
            return string.Empty;
        }

        public static string TryExtractSha256FromReleaseBody(string rawBody)
        {
            if (string.IsNullOrEmpty(rawBody)) return string.Empty;
            string[] lines = rawBody.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            int shaSectionWindow = 0;
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i];
                bool mentionsChecksum =
                    line.IndexOf("SHA-256", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    line.IndexOf("SHA256", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    line.IndexOf("OcarinaAtlas-Windows-x64.zip", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    line.IndexOf("amd64", StringComparison.OrdinalIgnoreCase) >= 0;

                if (mentionsChecksum)
                {
                    shaSectionWindow = 5;
                }

                if (mentionsChecksum || shaSectionWindow > 0)
                {
                    Match match = Sha256TokenRegex.Match(line);
                    if (match.Success)
                    {
                        return match.Groups[1].Value.ToLowerInvariant();
                    }
                    if (shaSectionWindow > 0)
                    {
                        shaSectionWindow--;
                    }
                }
            }
            return string.Empty;
        }

        public static string ComputeFileSha256(string filePath)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream fs = File.OpenRead(filePath))
            {
                byte[] hash = sha.ComputeHash(fs);
                StringBuilder sb = new StringBuilder(hash.Length * 2);
                for (int i = 0; i < hash.Length; i++)
                {
                    sb.Append(hash[i].ToString("x2", CultureInfo.InvariantCulture));
                }
                return sb.ToString();
            }
        }

        public static string FetchExpectedSha256(string sha256Url, string userAgent)
        {
            if (!IsAllowedUpdateUrl(sha256Url))
            {
                throw new InvalidOperationException("Blocked untrusted SHA-256 checksum URL.");
            }
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(sha256Url);
            req.Method = "GET";
            req.Timeout = 10000;
            req.ReadWriteTimeout = 10000;
            req.UserAgent = userAgent;

            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            {
                if (resp.StatusCode != HttpStatusCode.OK)
                {
                    throw new InvalidOperationException("Checksum download failed with HTTP " + (int)resp.StatusCode);
                }
                if (resp.ResponseUri == null || !IsAllowedUpdateUrl(resp.ResponseUri.AbsoluteUri))
                {
                    throw new InvalidOperationException("Checksum redirect pointed to an untrusted host.");
                }
                using (Stream stream = resp.GetResponseStream())
                {
                    if (stream == null)
                    {
                        throw new InvalidOperationException("Empty checksum response stream.");
                    }
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        string body = reader.ReadToEnd();
                        string parsed = ParseSha256DigestText(body);
                        if (string.IsNullOrEmpty(parsed))
                        {
                            throw new InvalidOperationException("Invalid SHA-256 checksum format in release asset.");
                        }
                        return parsed;
                    }
                }
            }
        }

        public static void VerifyDownloadedArchiveSha256(UpdateInfo info, string zipPath, string userAgent)
        {
            if (info == null)
            {
                throw new InvalidOperationException("Missing update metadata.");
            }
            if (string.IsNullOrEmpty(zipPath) || !File.Exists(zipPath))
            {
                throw new FileNotFoundException("Downloaded update archive not found.", zipPath);
            }

            string assetSha256 = string.Empty;
            if (!string.IsNullOrEmpty(info.Sha256DownloadUrl))
            {
                assetSha256 = FetchExpectedSha256(info.Sha256DownloadUrl, userAgent);
            }

            string notesSha256 = info.ExpectedSha256 ?? string.Empty;
            if (!string.IsNullOrEmpty(assetSha256) &&
                !string.IsNullOrEmpty(notesSha256) &&
                !string.Equals(assetSha256, notesSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "SHA-256 mismatch between release checksum file and release notes. Download official releases from " + OfficialRepoUrl);
            }

            string expectedSha256 = !string.IsNullOrEmpty(assetSha256) ? assetSha256 : notesSha256;
            if (string.IsNullOrEmpty(expectedSha256))
            {
                if (info.RequireSha256)
                {
                    throw new InvalidOperationException(
                        "Missing official SHA-256 checksum. Download official releases from " + OfficialRepoUrl);
                }
                AppendUpdateLog("Update source provided no SHA-256 digest; skipping checksum verification.");
                return;
            }

            string actualSha256 = ComputeFileSha256(zipPath);
            if (!string.Equals(actualSha256, expectedSha256, StringComparison.OrdinalIgnoreCase))
            {
                AppendUpdateLog("SHA-256 verification failed! Expected=" + expectedSha256 + " Actual=" + actualSha256);
                throw new InvalidOperationException(
                    "SHA-256 verification failed! Update aborted. Download official releases from " + OfficialRepoUrl);
            }

            AppendUpdateLog("SHA-256 verified: " + actualSha256);
        }

        public static Version ParseComparableVersion(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return null;
            string s = raw.Trim();
            if (s.StartsWith("v", StringComparison.OrdinalIgnoreCase))
            {
                s = s.Substring(1);
            }
            int dash = s.IndexOf('-');
            if (dash >= 0)
            {
                s = s.Substring(0, dash);
            }
            int plus = s.IndexOf('+');
            if (plus >= 0)
            {
                s = s.Substring(0, plus);
            }
            Version parsed;
            if (Version.TryParse(s, out parsed))
            {
                return parsed;
            }
            return null;
        }

        public static UpdateInfo ParseReleaseJson(string json, string currentAppVersion)
        {
            return ParseReleaseJson(json, currentAppVersion, null);
        }

        public static UpdateInfo ParseReleaseJson(string json, string currentAppVersion, string feedUrl)
        {
            Dictionary<string, object> obj = SimpleJsonParser.ParseObject(json);
            if (obj == null) return null;

            if (SimpleJsonParser.GetBool(obj, "prerelease") || SimpleJsonParser.GetBool(obj, "draft"))
            {
                return null;
            }

            string tagName = SimpleJsonParser.GetString(obj, "tag_name");
            Version latestVer = ParseComparableVersion(tagName);
            Version currentVer = ParseComparableVersion(currentAppVersion);
            if (latestVer == null || currentVer == null || latestVer <= currentVer)
            {
                return null;
            }

            string displayTag = tagName.Trim();
            if (!displayTag.StartsWith("v", StringComparison.OrdinalIgnoreCase))
            {
                displayTag = "v" + displayTag;
            }

            string releaseName = SimpleJsonParser.GetString(obj, "name");
            if (string.IsNullOrEmpty(releaseName))
            {
                releaseName = displayTag;
            }
            else
            {
                releaseName = releaseName.Trim();
            }

            string rawBody = SimpleJsonParser.GetString(obj, "body");
            string cleanNotes = CleanReleaseNotes(rawBody);

            string htmlUrl = SimpleJsonParser.GetString(obj, "html_url");
            string targetHtmlUrl = DefaultReleaseFallbackUrl;
            if (!string.IsNullOrEmpty(htmlUrl) && IsAllowedUpdateUrl(htmlUrl))
            {
                targetHtmlUrl = htmlUrl.Trim();
            }

            string zipUrl = string.Empty;
            string zipAssetName = string.Empty;
            string fallbackZipUrl = string.Empty;
            string fallbackZipAssetName = string.Empty;
            Dictionary<string, string> sha256Assets = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            List<object> assets = SimpleJsonParser.GetArray(obj, "assets");
            if (assets != null)
            {
                for (int i = 0; i < assets.Count; i++)
                {
                    Dictionary<string, object> asset = assets[i] as Dictionary<string, object>;
                    if (asset == null) continue;

                    string assetName = SimpleJsonParser.GetString(asset, "name");
                    string downloadUrl = SimpleJsonParser.GetString(asset, "browser_download_url");
                    if (string.IsNullOrEmpty(assetName) || string.IsNullOrEmpty(downloadUrl)) continue;
                    if (!IsAllowedUpdateUrl(downloadUrl)) continue;

                    string trimmedUrl = downloadUrl.Trim();
                    if (string.Equals(assetName, "OcarinaAtlas-Windows-x64.zip", StringComparison.OrdinalIgnoreCase))
                    {
                        zipUrl = trimmedUrl;
                        zipAssetName = assetName.Trim();
                    }
                    else if (string.IsNullOrEmpty(fallbackZipUrl) &&
                             assetName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        fallbackZipUrl = trimmedUrl;
                        fallbackZipAssetName = assetName.Trim();
                    }
                    else if (assetName.EndsWith(".sha256", StringComparison.OrdinalIgnoreCase))
                    {
                        sha256Assets[assetName.Trim()] = trimmedUrl;
                    }
                }
            }

            if (string.IsNullOrEmpty(zipUrl))
            {
                zipUrl = fallbackZipUrl;
                zipAssetName = fallbackZipAssetName;
            }

            string sha256DownloadUrl = string.Empty;
            if (!string.IsNullOrEmpty(zipAssetName))
            {
                string directMatch;
                if (sha256Assets.TryGetValue(zipAssetName + ".sha256", out directMatch))
                {
                    sha256DownloadUrl = directMatch;
                }
            }
            if (string.IsNullOrEmpty(sha256DownloadUrl))
            {
                string preferredSha256;
                if (sha256Assets.TryGetValue("OcarinaAtlas-Windows-x64.zip.sha256", out preferredSha256))
                {
                    sha256DownloadUrl = preferredSha256;
                }
            }

            string expectedSha256 = TryExtractSha256FromReleaseBody(rawBody);
            Uri feedUri;
            bool isOfficialFeed = string.IsNullOrEmpty(feedUrl) ||
                (Uri.TryCreate(feedUrl.Trim(), UriKind.Absolute, out feedUri) && IsOfficialRepoUri(feedUri));
            Uri zipUri;
            bool isOfficialZip = !string.IsNullOrEmpty(zipUrl) &&
                Uri.TryCreate(zipUrl, UriKind.Absolute, out zipUri) &&
                IsOfficialRepoUri(zipUri);

            UpdateInfo info = new UpdateInfo();
            info.DisplayTag = displayTag;
            info.ReleaseName = releaseName;
            info.ReleaseNotes = cleanNotes;
            info.HtmlUrl = targetHtmlUrl;
            info.ZipDownloadUrl = zipUrl;
            info.Sha256DownloadUrl = sha256DownloadUrl;
            info.ExpectedSha256 = expectedSha256;
            info.RequireSha256 = isOfficialFeed && isOfficialZip;
            info.ParsedVersion = latestVer;
            return info;
        }

        public static string CleanReleaseNotes(string raw)
        {
            if (string.IsNullOrEmpty(raw))
            {
                return "No release notes provided.";
            }
            string normalized = raw.Replace("\r\n", "\n").Replace("\r", "\n").Trim();
            if (normalized.Length == 0)
            {
                return "No release notes provided.";
            }
            return normalized.Replace("\n", Environment.NewLine);
        }

        public static string GetSkippedVersionFilePath()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(Path.Combine(localAppData, "OcarinaAtlas"), "skipped-version.txt");
        }

        public static string ReadSkippedVersion()
        {
            return ReadSkippedVersion(GetSkippedVersionFilePath());
        }

        public static string ReadSkippedVersion(string filePath)
        {
            try
            {
                if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) return string.Empty;
                return (File.ReadAllText(filePath, Encoding.UTF8) ?? string.Empty).Trim();
            }
            catch
            {
                return string.Empty;
            }
        }

        public static void WriteSkippedVersion(string versionTag)
        {
            WriteSkippedVersion(versionTag, GetSkippedVersionFilePath());
        }

        public static void WriteSkippedVersion(string versionTag, string filePath)
        {
            if (string.IsNullOrEmpty(filePath)) return;
            string dir = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
            File.WriteAllText(filePath, (versionTag ?? string.Empty).Trim(), Encoding.UTF8);
        }

        public static string GetUpdateLogPath()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrEmpty(localAppData))
            {
                localAppData = Path.GetTempPath();
            }
            return Path.Combine(Path.Combine(localAppData, "OcarinaAtlas"), "update.log");
        }

        public static void AppendUpdateLog(string message)
        {
            try
            {
                string logPath = GetUpdateLogPath();
                string dir = Path.GetDirectoryName(logPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                string line = string.Format(
                    CultureInfo.InvariantCulture,
                    "[{0:yyyy-MM-dd HH:mm:ss.fff}] {1}{2}",
                    DateTime.Now,
                    message ?? string.Empty,
                    Environment.NewLine);
                File.AppendAllText(logPath, line, Encoding.UTF8);
            }
            catch
            {
                // Never crash the launcher if diagnostics logging cannot write.
            }
        }

        public static string FindExtractedSourceRoot(string extractDir)
        {
            if (string.IsNullOrEmpty(extractDir) || !Directory.Exists(extractDir))
            {
                throw new DirectoryNotFoundException("Extracted update directory does not exist.");
            }

            // 1. Check ZIP root first (in case archive has no wrapper folder).
            if (File.Exists(Path.Combine(extractDir, "OcarinaAtlas.exe")))
            {
                return extractDir;
            }

            // 2. Check standard release wrapper folder.
            string preferredDir = Path.Combine(extractDir, "OcarinaAtlas-Windows-x64");
            if (File.Exists(Path.Combine(preferredDir, "OcarinaAtlas.exe")))
            {
                return preferredDir;
            }

            // 3. Unwrap any single top-level directory containing OcarinaAtlas.exe.
            string[] rootFiles = Directory.GetFiles(extractDir);
            string[] rootDirs = Directory.GetDirectories(extractDir);
            if (rootFiles.Length == 0 && rootDirs.Length == 1)
            {
                if (File.Exists(Path.Combine(rootDirs[0], "OcarinaAtlas.exe")))
                {
                    return rootDirs[0];
                }
            }

            // 4. Fallback recursive search.
            string[] matches = Directory.GetFiles(extractDir, "OcarinaAtlas.exe", SearchOption.AllDirectories);
            if (matches.Length > 0)
            {
                return Path.GetDirectoryName(matches[0]);
            }

            throw new InvalidOperationException("OcarinaAtlas.exe was not found inside the extracted update archive.");
        }

        private static string EscapePsSingleQuoted(string value)
        {
            return (value ?? string.Empty).Replace("'", "''");
        }

        public static string BuildUpdaterPowerShellScript(int targetPid, string sourceRoot, string targetDir, string tempDir, string exeName, string logPath)
        {
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("$ErrorActionPreference = 'Stop'");
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$targetPid = {0}", targetPid));
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$src = '{0}'", EscapePsSingleQuoted(sourceRoot)));
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$dst = '{0}'", EscapePsSingleQuoted(targetDir)));
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$tmp = '{0}'", EscapePsSingleQuoted(tempDir)));
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$exeName = '{0}'", EscapePsSingleQuoted(exeName)));
            sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "$logPath = '{0}'", EscapePsSingleQuoted(logPath)));
            sb.AppendLine("$logDir = Split-Path -Parent $logPath");
            sb.AppendLine("if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {");
            sb.AppendLine("    New-Item -ItemType Directory -Path $logDir -Force | Out-Null");
            sb.AppendLine("}");
            sb.AppendLine("function Write-UpdateLog([string]$msg) {");
            sb.AppendLine("    try {");
            sb.AppendLine("        $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff')");
            sb.AppendLine("        Add-Content -LiteralPath $logPath -Value \"[$ts] $msg\" -Encoding UTF8 -ErrorAction SilentlyContinue");
            sb.AppendLine("    } catch {}");
            sb.AppendLine("}");
            sb.AppendLine("Write-UpdateLog \"Updater started: targetPid=$targetPid src=$src dst=$dst\"");
            sb.AppendLine("$backupDir = Join-Path $tmp 'backup'");
            sb.AppendLine("$replaced = $false");
            sb.AppendLine("try {");
            sb.AppendLine("    try {");
            sb.AppendLine("        $targetProc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue");
            sb.AppendLine("        if ($targetProc) {");
            sb.AppendLine("            Write-UpdateLog \"Waiting for target PID $targetPid to exit...\"");
            sb.AppendLine("            if (-not $targetProc.WaitForExit(20000)) {");
            sb.AppendLine("                Write-UpdateLog \"Target PID $targetPid timed out; stopping process.\"");
            sb.AppendLine("                Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue");
            sb.AppendLine("                $targetProc.WaitForExit(5000) | Out-Null");
            sb.AppendLine("            }");
            sb.AppendLine("        }");
            sb.AppendLine("    } catch {");
            sb.AppendLine("        Write-UpdateLog \"Target wait note: $($_.Exception.Message)\"");
            sb.AppendLine("    }");
            sb.AppendLine("    $dstNorm = [System.IO.Path]::GetFullPath($dst).TrimEnd('\\') + '\\'");
            sb.AppendLine("    foreach ($procName in @('OcarinaAtlas', 'node')) {");
            sb.AppendLine("        try {");
            sb.AppendLine("            $procs = Get-Process -Name $procName -ErrorAction SilentlyContinue");
            sb.AppendLine("            foreach ($p in $procs) {");
            sb.AppendLine("                try {");
            sb.AppendLine("                    $pPath = $p.MainModule.FileName");
            sb.AppendLine("                    if ($pPath -and $pPath.StartsWith($dstNorm, [System.StringComparison]::OrdinalIgnoreCase)) {");
            sb.AppendLine("                        Write-UpdateLog \"Stopping lingering $($p.ProcessName) (PID $($p.Id)) at $pPath\"");
            sb.AppendLine("                        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue");
            sb.AppendLine("                        $p.WaitForExit(5000) | Out-Null");
            sb.AppendLine("                    }");
            sb.AppendLine("                } catch {}");
            sb.AppendLine("            }");
            sb.AppendLine("        } catch {}");
            sb.AppendLine("    }");
            sb.AppendLine("    Start-Sleep -Milliseconds 400");
            sb.AppendLine("    $srcNorm = [System.IO.Path]::GetFullPath($src).TrimEnd('\\') + '\\'");
            sb.AppendLine("    $srcFiles = [System.IO.Directory]::GetFiles($srcNorm, '*', [System.IO.SearchOption]::AllDirectories)");
            sb.AppendLine("    Write-UpdateLog \"Copying $($srcFiles.Length) files from $srcNorm to $dstNorm\"");
            sb.AppendLine("    $backedUp = New-Object 'System.Collections.Generic.List[string]'");
            sb.AppendLine("    try {");
            sb.AppendLine("        foreach ($srcFile in $srcFiles) {");
            sb.AppendLine("            $rel = $srcFile.Substring($srcNorm.Length)");
            sb.AppendLine("            $dstFile = Join-Path $dstNorm $rel");
            sb.AppendLine("            $dstParent = Split-Path -Parent $dstFile");
            sb.AppendLine("            if ($dstParent -and -not (Test-Path -LiteralPath $dstParent)) {");
            sb.AppendLine("                New-Item -ItemType Directory -Path $dstParent -Force | Out-Null");
            sb.AppendLine("            }");
            sb.AppendLine("            if ((Test-Path -LiteralPath $dstFile) -and ($rel -ne $exeName)) {");
            sb.AppendLine("                try {");
            sb.AppendLine("                    $sInfo = Get-Item -LiteralPath $srcFile");
            sb.AppendLine("                    $dInfo = Get-Item -LiteralPath $dstFile");
            sb.AppendLine("                    if (($sInfo.Length -eq $dInfo.Length) -and ($rel.StartsWith('runtime\\', [System.StringComparison]::OrdinalIgnoreCase) -or $rel.StartsWith('app\\dist\\client\\content\\', [System.StringComparison]::OrdinalIgnoreCase))) {");
            sb.AppendLine("                        continue");
            sb.AppendLine("                    }");
            sb.AppendLine("                } catch {}");
            sb.AppendLine("            }");
            sb.AppendLine("            if (Test-Path -LiteralPath $dstFile) {");
            sb.AppendLine("                $bakFile = Join-Path $backupDir $rel");
            sb.AppendLine("                $bakParent = Split-Path -Parent $bakFile");
            sb.AppendLine("                if ($bakParent -and -not (Test-Path -LiteralPath $bakParent)) {");
            sb.AppendLine("                    New-Item -ItemType Directory -Path $bakParent -Force | Out-Null");
            sb.AppendLine("                }");
            sb.AppendLine("                [System.IO.File]::Copy($dstFile, $bakFile, $true)");
            sb.AppendLine("                $backedUp.Add($rel)");
            sb.AppendLine("            }");
            sb.AppendLine("            $fileCopied = $false");
            sb.AppendLine("            for ($attempt = 1; $attempt -le 20; $attempt++) {");
            sb.AppendLine("                try {");
            sb.AppendLine("                    if (Test-Path -LiteralPath $dstFile) {");
            sb.AppendLine("                        $attr = [System.IO.File]::GetAttributes($dstFile)");
            sb.AppendLine("                        if (($attr -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {");
            sb.AppendLine("                            [System.IO.File]::SetAttributes($dstFile, ($attr -band (-bnot [System.IO.FileAttributes]::ReadOnly)))");
            sb.AppendLine("                        }");
            sb.AppendLine("                    }");
            sb.AppendLine("                    [System.IO.File]::Copy($srcFile, $dstFile, $true)");
            sb.AppendLine("                    $fileCopied = $true");
            sb.AppendLine("                    break");
            sb.AppendLine("                } catch {");
            sb.AppendLine("                    if ($attempt -eq 20) {");
            sb.AppendLine("                        throw \"Failed to replace '$rel' after 20 attempts: $($_.Exception.Message)\"");
            sb.AppendLine("                    }");
            sb.AppendLine("                    Start-Sleep -Milliseconds 500");
            sb.AppendLine("                }");
            sb.AppendLine("            }");
            sb.AppendLine("        }");
            sb.AppendLine("        $srcExe = Join-Path $srcNorm $exeName");
            sb.AppendLine("        $dstExe = Join-Path $dstNorm $exeName");
            sb.AppendLine("        if (-not (Test-Path -LiteralPath $dstExe)) {");
            sb.AppendLine("            throw \"Post-copy verification failed: '$dstExe' is missing.\"");
            sb.AppendLine("        }");
            sb.AppendLine("        $srcLen = (Get-Item -LiteralPath $srcExe).Length");
            sb.AppendLine("        $dstLen = (Get-Item -LiteralPath $dstExe).Length");
            sb.AppendLine("        if ($srcLen -ne $dstLen) {");
            sb.AppendLine("            throw \"Post-copy verification failed: '$dstExe' size ($dstLen) != source size ($srcLen).\"");
            sb.AppendLine("        }");
            sb.AppendLine("        Write-UpdateLog \"Update applied successfully ($($srcFiles.Length) files, $exeName=$dstLen bytes).\"");
            sb.AppendLine("        $replaced = $true");
            sb.AppendLine("    } catch {");
            sb.AppendLine("        Write-UpdateLog \"ERROR during file swap: $($_.Exception.Message)\"");
            sb.AppendLine("        foreach ($rel in $backedUp) {");
            sb.AppendLine("            try {");
            sb.AppendLine("                $bakFile = Join-Path $backupDir $rel");
            sb.AppendLine("                $dstFile = Join-Path $dstNorm $rel");
            sb.AppendLine("                if (Test-Path -LiteralPath $bakFile) {");
            sb.AppendLine("                    [System.IO.File]::Copy($bakFile, $dstFile, $true)");
            sb.AppendLine("                }");
            sb.AppendLine("            } catch {}");
            sb.AppendLine("        }");
            sb.AppendLine("        Write-UpdateLog \"Rolled back $($backedUp.Count) backed-up files.\"");
            sb.AppendLine("    }");
            sb.AppendLine("} catch {");
            sb.AppendLine("    Write-UpdateLog \"FATAL updater error: $($_.Exception.Message)\"");
            sb.AppendLine("} finally {");
            sb.AppendLine("    $exe = Join-Path $dst $exeName");
            sb.AppendLine("    if (Test-Path -LiteralPath $exe) {");
            sb.AppendLine("        try { Unblock-File -LiteralPath $exe -ErrorAction SilentlyContinue } catch {}");
            sb.AppendLine("        Write-UpdateLog \"Relaunching $exe (replaced=$replaced)\"");
            sb.AppendLine("        $relaunched = $false");
            sb.AppendLine("        for ($launchAttempt = 1; $launchAttempt -le 10; $launchAttempt++) {");
            sb.AppendLine("            try {");
            sb.AppendLine("                $startedProc = Start-Process -FilePath $exe -WorkingDirectory $dst -WindowStyle Normal -PassThru -ErrorAction Stop");
            sb.AppendLine("                if ($startedProc) {");
            sb.AppendLine("                    Write-UpdateLog \"Relaunched PID $($startedProc.Id) on attempt $launchAttempt\"");
            sb.AppendLine("                    $relaunched = $true");
            sb.AppendLine("                    break");
            sb.AppendLine("                }");
            sb.AppendLine("            } catch {");
            sb.AppendLine("                Write-UpdateLog \"Relaunch attempt $launchAttempt failed: $($_.Exception.Message)\"");
            sb.AppendLine("                try {");
            sb.AppendLine("                    $psiFallback = New-Object System.Diagnostics.ProcessStartInfo");
            sb.AppendLine("                    $psiFallback.FileName = $exe");
            sb.AppendLine("                    $psiFallback.WorkingDirectory = $dst");
            sb.AppendLine("                    $psiFallback.UseShellExecute = $true");
            sb.AppendLine("                    $psiFallback.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal");
            sb.AppendLine("                    $fbProc = [System.Diagnostics.Process]::Start($psiFallback)");
            sb.AppendLine("                    if ($fbProc) {");
            sb.AppendLine("                        Write-UpdateLog \"Relaunched via fallback PID $($fbProc.Id) on attempt $launchAttempt\"");
            sb.AppendLine("                        $relaunched = $true");
            sb.AppendLine("                        break");
            sb.AppendLine("                    }");
            sb.AppendLine("                } catch {}");
            sb.AppendLine("                Start-Sleep -Milliseconds 400");
            sb.AppendLine("            }");
            sb.AppendLine("        }");
            sb.AppendLine("        if (-not $relaunched) {");
            sb.AppendLine("            Write-UpdateLog \"ERROR: All relaunch attempts failed for $exe\"");
            sb.AppendLine("        }");
            sb.AppendLine("    } else {");
            sb.AppendLine("        Write-UpdateLog \"ERROR: Cannot relaunch missing executable $exe\"");
            sb.AppendLine("    }");
            sb.AppendLine("    try {");
            sb.AppendLine("        if (Test-Path -LiteralPath $tmp) {");
            sb.AppendLine("            Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue");
            sb.AppendLine("        }");
            sb.AppendLine("    } catch {}");
            sb.AppendLine("}");
            return sb.ToString();
        }

        public static void LaunchDetachedUpdater(int targetPid, string sourceRoot, string targetDir, string tempDir)
        {
            string exeName = Path.GetFileName(Application.ExecutablePath);
            if (string.IsNullOrEmpty(exeName))
            {
                exeName = "OcarinaAtlas.exe";
            }

            string logPath = GetUpdateLogPath();
            AppendUpdateLog(string.Format(
                CultureInfo.InvariantCulture,
                "Launching detached updater (pid={0}, src={1}, dst={2}, tmp={3})",
                targetPid,
                sourceRoot,
                targetDir,
                tempDir));

            string script = BuildUpdaterPowerShellScript(targetPid, sourceRoot, targetDir, tempDir, exeName, logPath);
            byte[] scriptBytes = Encoding.Unicode.GetBytes(script);
            string encoded = Convert.ToBase64String(scriptBytes);

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "powershell.exe";
            psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + encoded;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process started = Process.Start(psi);
            if (started == null)
            {
                throw new InvalidOperationException("Failed to start detached PowerShell updater process.");
            }
        }
    }

    internal sealed class UpdateDialog : Form
    {
        private readonly MainForm _ownerForm;
        private readonly UpdateInfo _info;
        private readonly RichTextBox _notesBox;
        private readonly Label _statusLabel;
        private readonly ProgressBar _progressBar;
        private readonly Button _updateNowButton;
        private readonly Button _skipButton;
        private readonly Button _closeButton;
        private bool _isUpdating;

        public UpdateDialog(MainForm ownerForm, UpdateInfo info, Icon appIcon)
        {
            _ownerForm = ownerForm;
            _info = info;

            SuspendLayout();

            Text = "Update Available \u2014 Ocarina Atlas";
            BackColor = Theme.Ink950;
            ForeColor = Theme.Parchment200;
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ClientSize = new Size(520, 412);
            if (appIcon != null) Icon = appIcon;
            Theme.EnableDarkTitleBar(this);

            Label headerLabel = new Label();
            headerLabel.Text = "Update Available: " + info.DisplayTag;
            headerLabel.Font = new Font("Segoe UI", 12.5f, FontStyle.Bold);
            headerLabel.ForeColor = Theme.Parchment50;
            headerLabel.AutoSize = true;
            headerLabel.Location = new Point(20, 16);
            Controls.Add(headerLabel);

            Label versionLabel = new Label();
            versionLabel.Text = string.Format(
                CultureInfo.InvariantCulture,
                "Installed: v{0}   \u2192   Latest: {1}",
                MainForm.AppVersion,
                info.DisplayTag);
            versionLabel.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            versionLabel.ForeColor = Theme.Moss;
            versionLabel.AutoSize = true;
            versionLabel.Location = new Point(22, 46);
            Controls.Add(versionLabel);

            Label notesTitle = new Label();
            notesTitle.Text = "Release Notes";
            notesTitle.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            notesTitle.ForeColor = Theme.Parchment400;
            notesTitle.AutoSize = true;
            notesTitle.Location = new Point(20, 72);
            Controls.Add(notesTitle);

            BorderedPanel notesContainer = new BorderedPanel();
            notesContainer.Location = new Point(20, 94);
            notesContainer.Size = new Size(480, 212);
            notesContainer.FillColor = Theme.Ink900;
            notesContainer.BorderColor = Theme.Ink700;
            notesContainer.CornerRadius = 8;
            notesContainer.Padding = new Padding(8, 6, 8, 6);
            Controls.Add(notesContainer);

            _notesBox = new RichTextBox();
            _notesBox.ReadOnly = true;
            _notesBox.ScrollBars = RichTextBoxScrollBars.Vertical;
            _notesBox.WordWrap = true;
            _notesBox.DetectUrls = true;
            _notesBox.BorderStyle = BorderStyle.None;
            _notesBox.Dock = DockStyle.Fill;
            _notesBox.BackColor = Theme.Ink900;
            _notesBox.ForeColor = Theme.Parchment200;
            _notesBox.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            _notesBox.LinkClicked += OnNotesLinkClicked;
            RenderMarkdownToRichTextBox(_notesBox, info.ReleaseNotes);
            notesContainer.Controls.Add(_notesBox);

            _statusLabel = new Label();
            _statusLabel.Text = string.Empty;
            _statusLabel.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            _statusLabel.ForeColor = Theme.Parchment400;
            _statusLabel.AutoSize = false;
            _statusLabel.Location = new Point(20, 314);
            _statusLabel.Size = new Size(480, 20);
            _statusLabel.Visible = false;
            Controls.Add(_statusLabel);

            _progressBar = new ProgressBar();
            _progressBar.Location = new Point(20, 336);
            _progressBar.Size = new Size(480, 16);
            _progressBar.Minimum = 0;
            _progressBar.Maximum = 100;
            _progressBar.Visible = false;
            Controls.Add(_progressBar);

            _updateNowButton = CreateDialogButton("Update Now", 20, 364, 148, 32, true);
            _updateNowButton.BackColor = Color.FromArgb(0x2D, 0x4A, 0x2A);
            _updateNowButton.ForeColor = Theme.Parchment50;
            _updateNowButton.FlatAppearance.BorderColor = Theme.Moss;
            _updateNowButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(0x39, 0x5D, 0x35);
            _updateNowButton.Click += OnUpdateNowClick;
            Controls.Add(_updateNowButton);

            _skipButton = CreateDialogButton("Skip Version", 296, 364, 108, 32, false);
            _skipButton.ForeColor = Theme.Gold;
            _skipButton.FlatAppearance.BorderColor = Theme.Gold;
            _skipButton.Click += OnSkipVersionClick;
            Controls.Add(_skipButton);

            _closeButton = CreateDialogButton("Close", 412, 364, 88, 32, false);
            _closeButton.DialogResult = DialogResult.Cancel;
            Controls.Add(_closeButton);
            CancelButton = _closeButton;

            ResumeLayout(false);
            PerformLayout();

            Shown += delegate
            {
                _notesBox.Select(0, 0);
                _notesBox.ScrollToCaret();
                _updateNowButton.Focus();
            };

            FormClosing += delegate(object sender, FormClosingEventArgs e)
            {
                if (_isUpdating)
                {
                    e.Cancel = true;
                }
            };
        }

        private static Button CreateDialogButton(string text, int x, int y, int width, int height, bool bold)
        {
            Button btn = new Button();
            btn.Text = text;
            btn.Location = new Point(x, y);
            btn.Size = new Size(width, height);
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 1;
            btn.FlatAppearance.BorderColor = Theme.Ink700;
            btn.FlatAppearance.MouseOverBackColor = Theme.Ink700;
            btn.BackColor = Theme.Ink800;
            btn.ForeColor = Theme.Parchment200;
            btn.Font = new Font("Segoe UI", 9f, bold ? FontStyle.Bold : FontStyle.Regular);
            btn.Cursor = Cursors.Hand;
            btn.UseVisualStyleBackColor = false;
            return btn;
        }

        private void OnNotesLinkClicked(object sender, LinkClickedEventArgs e)
        {
            if (e == null || string.IsNullOrEmpty(e.LinkText)) return;
            Uri uri;
            if (!Uri.TryCreate(e.LinkText, UriKind.Absolute, out uri)) return;
            if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(uri.AbsoluteUri);
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch
            {
                // Non-fatal if no browser handler is registered.
            }
        }

        private static void RenderMarkdownToRichTextBox(RichTextBox box, string markdown)
        {
            if (box == null) return;
            box.Clear();
            if (string.IsNullOrEmpty(markdown)) return;

            string normalized = markdown.Replace("\r\n", "\n").Replace('\r', '\n');
            string[] lines = normalized.Split('\n');

            Dictionary<string, Font> fonts = new Dictionary<string, Font>(StringComparer.Ordinal);
            try
            {
                Font bodyFont = GetCachedFont(fonts, "Segoe UI", 9f, FontStyle.Regular);
                Font bodyBoldFont = GetCachedFont(fonts, "Segoe UI", 9f, FontStyle.Bold);
                Font codeFont = GetCachedFont(fonts, "Consolas", 8.75f, FontStyle.Regular);

                bool inCodeBlock = false;
                bool hasOutput = false;

                for (int lineIndex = 0; lineIndex < lines.Length; lineIndex++)
                {
                    string line = lines[lineIndex];
                    string trimmed = line.Trim();

                    if (trimmed.StartsWith("```", StringComparison.Ordinal))
                    {
                        inCodeBlock = !inCodeBlock;
                        continue;
                    }

                    if (hasOutput)
                    {
                        AppendStyledText(box, "\n", bodyFont, Theme.Parchment200);
                    }

                    if (inCodeBlock)
                    {
                        SetParagraphIndent(box, 12, 0);
                        AppendStyledText(box, line, codeFont, Theme.Parchment300);
                        hasOutput = true;
                        continue;
                    }

                    if (trimmed.Length == 0)
                    {
                        SetParagraphIndent(box, 0, 0);
                        hasOutput = true;
                        continue;
                    }

                    if (IsHorizontalRule(trimmed))
                    {
                        SetParagraphIndent(box, 0, 0);
                        AppendStyledText(box, new string('\u2500', 38), bodyFont, Theme.Ink600);
                        hasOutput = true;
                        continue;
                    }

                    int headingLevel;
                    string headingText;
                    if (TryParseHeading(trimmed, out headingLevel, out headingText))
                    {
                        float headingSize = headingLevel == 1 ? 12.5f : (headingLevel == 2 ? 11f : (headingLevel == 3 ? 10f : 9.5f));
                        Color headingColor = headingLevel <= 2 ? Theme.Gold : Theme.Parchment50;
                        SetParagraphIndent(box, 0, 0);
                        AppendInlineMarkdown(box, fonts, headingText, "Segoe UI", headingSize, FontStyle.Bold, headingColor);
                        hasOutput = true;
                        continue;
                    }

                    if (trimmed.StartsWith(">", StringComparison.Ordinal))
                    {
                        string quoteText = StripBlockquotePrefix(trimmed);
                        SetParagraphIndent(box, 12, 12);
                        AppendStyledText(box, "\u2502 ", bodyFont, Theme.Parchment600);
                        AppendInlineMarkdown(box, fonts, quoteText, "Segoe UI", 9f, FontStyle.Italic, Theme.Parchment400);
                        hasOutput = true;
                        continue;
                    }

                    int indentLevel;
                    string listItemText;
                    if (TryParseBulletListItem(line, out indentLevel, out listItemText))
                    {
                        SetParagraphIndent(box, 8 + indentLevel * 14, 14);
                        AppendStyledText(box, "  \u2022  ", bodyFont, Theme.Gold);
                        AppendInlineMarkdown(box, fonts, listItemText, "Segoe UI", 9f, FontStyle.Regular, Theme.Parchment200);
                        hasOutput = true;
                        continue;
                    }

                    string numberPrefix;
                    if (TryParseNumberedListItem(line, out indentLevel, out numberPrefix, out listItemText))
                    {
                        SetParagraphIndent(box, 8 + indentLevel * 14, 18);
                        AppendStyledText(box, "  " + numberPrefix + ". ", bodyBoldFont, Theme.Gold);
                        AppendInlineMarkdown(box, fonts, listItemText, "Segoe UI", 9f, FontStyle.Regular, Theme.Parchment200);
                        hasOutput = true;
                        continue;
                    }

                    SetParagraphIndent(box, 0, 0);
                    AppendInlineMarkdown(box, fonts, line, "Segoe UI", 9f, FontStyle.Regular, Theme.Parchment200);
                    hasOutput = true;
                }

                box.SelectionStart = 0;
                box.SelectionLength = 0;
            }
            finally
            {
                foreach (Font f in fonts.Values)
                {
                    f.Dispose();
                }
            }
        }

        private static Font GetCachedFont(Dictionary<string, Font> fonts, string family, float size, FontStyle style)
        {
            string key = family + "|" + size.ToString("0.00", CultureInfo.InvariantCulture) + "|" + ((int)style).ToString(CultureInfo.InvariantCulture);
            Font cached;
            if (fonts.TryGetValue(key, out cached))
            {
                return cached;
            }

            Font created = new Font(family, size, style);
            fonts[key] = created;
            return created;
        }

        private static void SetParagraphIndent(RichTextBox box, int indent, int hangingIndent)
        {
            box.SelectionStart = box.TextLength;
            box.SelectionLength = 0;
            box.SelectionIndent = indent;
            box.SelectionHangingIndent = hangingIndent;
        }

        private static void AppendStyledText(RichTextBox box, string text, Font font, Color color)
        {
            if (string.IsNullOrEmpty(text)) return;
            box.SelectionStart = box.TextLength;
            box.SelectionLength = 0;
            box.SelectionFont = font;
            box.SelectionColor = color;
            box.AppendText(text);
        }

        private static bool IsHorizontalRule(string trimmed)
        {
            if (trimmed.Length < 3) return false;
            char marker = '\0';
            int count = 0;
            for (int i = 0; i < trimmed.Length; i++)
            {
                char c = trimmed[i];
                if (c == ' ' || c == '\t') continue;
                if (c != '-' && c != '*' && c != '_') return false;
                if (marker == '\0')
                {
                    marker = c;
                }
                else if (c != marker)
                {
                    return false;
                }
                count++;
            }
            return count >= 3;
        }

        private static bool TryParseHeading(string trimmed, out int level, out string text)
        {
            level = 0;
            text = string.Empty;
            int hashes = 0;
            while (hashes < trimmed.Length && hashes < 4 && trimmed[hashes] == '#')
            {
                hashes++;
            }
            if (hashes == 0 || hashes >= trimmed.Length) return false;
            if (trimmed[hashes] != ' ' && trimmed[hashes] != '\t') return false;

            level = hashes;
            text = trimmed.Substring(hashes).Trim();
            while (text.EndsWith("#", StringComparison.Ordinal))
            {
                int lastSpace = text.LastIndexOf(' ');
                if (lastSpace < 0) break;
                string trailing = text.Substring(lastSpace + 1);
                bool allHashes = trailing.Length > 0;
                for (int i = 0; i < trailing.Length; i++)
                {
                    if (trailing[i] != '#')
                    {
                        allHashes = false;
                        break;
                    }
                }
                if (!allHashes) break;
                text = text.Substring(0, lastSpace).TrimEnd();
            }
            return true;
        }

        private static string StripBlockquotePrefix(string trimmed)
        {
            string rest = trimmed;
            while (rest.StartsWith(">", StringComparison.Ordinal))
            {
                rest = rest.Substring(1);
                if (rest.StartsWith(" ", StringComparison.Ordinal))
                {
                    rest = rest.Substring(1);
                }
                rest = rest.TrimStart();
            }
            return rest;
        }

        private static bool TryParseBulletListItem(string line, out int indentLevel, out string itemText)
        {
            indentLevel = 0;
            itemText = string.Empty;
            int idx = 0;
            while (idx < line.Length && line[idx] == ' ')
            {
                idx++;
            }
            if (idx + 1 >= line.Length) return false;
            if ((line[idx] == '-' || line[idx] == '*') && (line[idx + 1] == ' ' || line[idx + 1] == '\t'))
            {
                indentLevel = Math.Min(3, idx / 2);
                itemText = line.Substring(idx + 2).TrimStart();
                return true;
            }
            return false;
        }

        private static bool TryParseNumberedListItem(string line, out int indentLevel, out string numberPrefix, out string itemText)
        {
            indentLevel = 0;
            numberPrefix = string.Empty;
            itemText = string.Empty;
            int idx = 0;
            while (idx < line.Length && line[idx] == ' ')
            {
                idx++;
            }
            int numStart = idx;
            while (idx < line.Length && char.IsDigit(line[idx]))
            {
                idx++;
            }
            if (idx == numStart || idx + 1 >= line.Length) return false;
            if (line[idx] == '.' && (line[idx + 1] == ' ' || line[idx + 1] == '\t'))
            {
                indentLevel = Math.Min(3, numStart / 2);
                numberPrefix = line.Substring(numStart, idx - numStart);
                itemText = line.Substring(idx + 2).TrimStart();
                return true;
            }
            return false;
        }

        private static void AppendInlineMarkdown(
            RichTextBox box,
            Dictionary<string, Font> fonts,
            string text,
            string baseFamily,
            float baseSize,
            FontStyle baseStyle,
            Color baseColor)
        {
            if (string.IsNullOrEmpty(text)) return;

            Font baseFont = GetCachedFont(fonts, baseFamily, baseSize, baseStyle);
            StringBuilder plain = new StringBuilder();
            int i = 0;

            while (i < text.Length)
            {
                char ch = text[i];

                if (ch == '\\' && i + 1 < text.Length)
                {
                    char next = text[i + 1];
                    if (next == '\\' || next == '*' || next == '`' || next == '[' || next == ']' || next == '_')
                    {
                        plain.Append(next);
                        i += 2;
                        continue;
                    }
                }

                if (ch == '`')
                {
                    int close = text.IndexOf('`', i + 1);
                    if (close > i + 1)
                    {
                        FlushPlainText(box, plain, baseFont, baseColor);
                        string code = text.Substring(i + 1, close - i - 1);
                        Font inlineCodeFont = GetCachedFont(fonts, "Consolas", Math.Max(8f, baseSize - 0.25f), FontStyle.Regular);
                        AppendStyledText(box, code, inlineCodeFont, Theme.Moss);
                        i = close + 1;
                        continue;
                    }
                }

                if (ch == '*' && i + 1 < text.Length && text[i + 1] == '*')
                {
                    int close = text.IndexOf("**", i + 2, StringComparison.Ordinal);
                    if (close > i + 2)
                    {
                        FlushPlainText(box, plain, baseFont, baseColor);
                        string inner = text.Substring(i + 2, close - i - 2);
                        AppendInlineMarkdown(box, fonts, inner, baseFamily, baseSize, baseStyle | FontStyle.Bold, baseColor);
                        i = close + 2;
                        continue;
                    }
                }

                if (ch == '*' && i + 1 < text.Length && !char.IsWhiteSpace(text[i + 1]))
                {
                    int close = FindClosingSingleAsterisk(text, i + 1);
                    if (close > i + 1)
                    {
                        FlushPlainText(box, plain, baseFont, baseColor);
                        string inner = text.Substring(i + 1, close - i - 1);
                        AppendInlineMarkdown(box, fonts, inner, baseFamily, baseSize, baseStyle | FontStyle.Italic, baseColor);
                        i = close + 1;
                        continue;
                    }
                }

                if (ch == '[')
                {
                    int labelEnd;
                    int urlEnd;
                    string label;
                    string url;
                    if (TryParseMarkdownLink(text, i, out labelEnd, out urlEnd, out label, out url))
                    {
                        FlushPlainText(box, plain, baseFont, baseColor);
                        bool isHttp = url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                                      url.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
                        if (isHttp && !string.Equals(label, url, StringComparison.OrdinalIgnoreCase))
                        {
                            AppendStyledText(box, label, GetCachedFont(fonts, baseFamily, baseSize, baseStyle), Theme.Parchment50);
                            AppendStyledText(box, " (", baseFont, Theme.Parchment400);
                            AppendStyledText(box, url, baseFont, Theme.Moss);
                            AppendStyledText(box, ")", baseFont, Theme.Parchment400);
                        }
                        else if (isHttp)
                        {
                            AppendStyledText(box, url, baseFont, Theme.Moss);
                        }
                        else
                        {
                            AppendStyledText(box, label, baseFont, Theme.Parchment50);
                        }
                        i = urlEnd + 1;
                        continue;
                    }
                }

                plain.Append(ch);
                i++;
            }

            FlushPlainText(box, plain, baseFont, baseColor);
        }

        private static void FlushPlainText(RichTextBox box, StringBuilder plain, Font font, Color color)
        {
            if (plain.Length == 0) return;
            AppendStyledText(box, plain.ToString(), font, color);
            plain.Length = 0;
        }

        private static int FindClosingSingleAsterisk(string text, int start)
        {
            for (int i = start; i < text.Length; i++)
            {
                if (text[i] != '*') continue;
                bool isDouble = (i + 1 < text.Length && text[i + 1] == '*') || (i > 0 && text[i - 1] == '*');
                if (isDouble) continue;
                if (!char.IsWhiteSpace(text[i - 1]))
                {
                    return i;
                }
            }
            return -1;
        }

        private static bool TryParseMarkdownLink(
            string text,
            int openBracketIndex,
            out int closeBracketIndex,
            out int closeParenIndex,
            out string label,
            out string url)
        {
            closeBracketIndex = -1;
            closeParenIndex = -1;
            label = string.Empty;
            url = string.Empty;

            int i = openBracketIndex + 1;
            while (i < text.Length)
            {
                if (text[i] == '\\' && i + 1 < text.Length)
                {
                    i += 2;
                    continue;
                }
                if (text[i] == ']')
                {
                    closeBracketIndex = i;
                    break;
                }
                if (text[i] == '\n') return false;
                i++;
            }

            if (closeBracketIndex <= openBracketIndex) return false;
            if (closeBracketIndex + 1 >= text.Length || text[closeBracketIndex + 1] != '(') return false;

            int parenEnd = text.IndexOf(')', closeBracketIndex + 2);
            if (parenEnd <= closeBracketIndex + 2) return false;

            closeParenIndex = parenEnd;
            label = text.Substring(openBracketIndex + 1, closeBracketIndex - openBracketIndex - 1);
            url = text.Substring(closeBracketIndex + 2, parenEnd - closeBracketIndex - 2).Trim();
            return true;
        }

        private void OnSkipVersionClick(object sender, EventArgs e)
        {
            try
            {
                UpdateManager.WriteSkippedVersion(_info.DisplayTag);
            }
            catch
            {
                // Non-fatal if %LOCALAPPDATA% is not writable.
            }
            DialogResult = DialogResult.Ignore;
            Close();
        }

        private sealed class ValidatedWebClient : WebClient
        {
            private static WebResponse ValidateResponse(WebRequest request, WebResponse response)
            {
                if (response == null)
                {
                    return null;
                }
                Uri initialUri = request != null ? request.RequestUri : null;
                Uri finalUri = response.ResponseUri;
                if (finalUri == null || !UpdateManager.IsAllowedRedirectUri(initialUri, finalUri))
                {
                    response.Close();
                    throw new InvalidOperationException("Update download redirect pointed to an untrusted host.");
                }
                return response;
            }

            protected override WebResponse GetWebResponse(WebRequest request)
            {
                WebResponse response = base.GetWebResponse(request);
                return ValidateResponse(request, response);
            }

            protected override WebResponse GetWebResponse(WebRequest request, IAsyncResult result)
            {
                WebResponse response = base.GetWebResponse(request, result);
                return ValidateResponse(request, response);
            }
        }

        private void OnUpdateNowClick(object sender, EventArgs e)
        {
            if (string.IsNullOrEmpty(_info.ZipDownloadUrl))
            {
                if (_ownerForm != null)
                {
                    _ownerForm.OpenUrlInBrowser(_info.HtmlUrl);
                }
                Close();
                return;
            }

            if (!UpdateManager.IsAllowedUpdateUrl(_info.ZipDownloadUrl))
            {
                FailUpdate(
                    "Blocked untrusted update URL. Download official releases from " + UpdateManager.OfficialRepoUrl,
                    null);
                return;
            }

            _isUpdating = true;
            _updateNowButton.Enabled = false;
            _skipButton.Enabled = false;
            _closeButton.Enabled = false;

            _statusLabel.Size = new Size(480, 20);
            _statusLabel.ForeColor = Theme.Parchment400;
            _statusLabel.Text = "Downloading " + _info.DisplayTag + "...";
            _statusLabel.Visible = true;
            _progressBar.Style = ProgressBarStyle.Blocks;
            _progressBar.Value = 0;
            _progressBar.Visible = true;

            string tempDir = Path.Combine(Path.GetTempPath(), "OcarinaAtlas-Update-" + Guid.NewGuid().ToString("N"));
            string zipPath = Path.Combine(tempDir, "update.zip");
            string extractDir = Path.Combine(tempDir, "extracted");

            try
            {
                Directory.CreateDirectory(tempDir);
                UpdateManager.AppendUpdateLog("Starting update to " + _info.DisplayTag + " from " + _info.ZipDownloadUrl);
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                ValidatedWebClient client = new ValidatedWebClient();
                client.Headers[HttpRequestHeader.UserAgent] = "OcarinaAtlas/" + MainForm.AppVersion;

                client.DownloadProgressChanged += delegate(object s, DownloadProgressChangedEventArgs args)
                {
                    if (IsDisposed) return;
                    if (args.TotalBytesToReceive > 0)
                    {
                        _progressBar.Style = ProgressBarStyle.Blocks;
                        int pct = Math.Max(0, Math.Min(100, args.ProgressPercentage));
                        _progressBar.Value = pct;
                        _statusLabel.Text = string.Format(
                            CultureInfo.InvariantCulture,
                            "Downloading {0}... {1}%",
                            _info.DisplayTag,
                            pct);
                    }
                    else
                    {
                        _progressBar.Style = ProgressBarStyle.Marquee;
                        double mb = args.BytesReceived / (1024.0 * 1024.0);
                        _statusLabel.Text = string.Format(
                            CultureInfo.InvariantCulture,
                            "Downloading {0}... {1:0.0} MB",
                            _info.DisplayTag,
                            mb);
                    }
                };

                client.DownloadFileCompleted += delegate(object s, AsyncCompletedEventArgs args)
                {
                    client.Dispose();
                    if (IsDisposed) return;

                    if (args.Error != null || args.Cancelled)
                    {
                        string msg = args.Error != null ? args.Error.Message : "Download cancelled.";
                        FailUpdate("Download failed: " + msg, tempDir);
                        return;
                    }

                    _progressBar.Style = ProgressBarStyle.Marquee;
                    _statusLabel.Text = "Verifying SHA-256 checksum...";

                    Thread extractThread = new Thread(delegate()
                    {
                        try
                        {
                            UpdateManager.VerifyDownloadedArchiveSha256(
                                _info,
                                zipPath,
                                "OcarinaAtlas/" + MainForm.AppVersion);

                            if (!IsDisposed && IsHandleCreated)
                            {
                                BeginInvoke((MethodInvoker)delegate()
                                {
                                    if (!IsDisposed)
                                    {
                                        _statusLabel.Text = "Extracting update archive...";
                                    }
                                });
                            }

                            UpdateManager.ExtractZipSafely(zipPath, extractDir);
                            string sourceRoot = UpdateManager.FindExtractedSourceRoot(extractDir);
                            string targetDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
                                Path.DirectorySeparatorChar,
                                Path.AltDirectorySeparatorChar);
                            UpdateManager.AppendUpdateLog("Extracted update to " + sourceRoot + " -> targetDir=" + targetDir);

                            if (!IsDisposed && IsHandleCreated)
                            {
                                BeginInvoke((MethodInvoker)delegate()
                                {
                                    try
                                    {
                                        _statusLabel.Text = "Applying update and restarting...";
                                        _isUpdating = false;
                                        if (_ownerForm != null)
                                        {
                                            _ownerForm.PrepareForSelfUpdate();
                                        }
                                        UpdateManager.LaunchDetachedUpdater(
                                            Process.GetCurrentProcess().Id,
                                            sourceRoot,
                                            targetDir,
                                            tempDir);
                                        DialogResult = DialogResult.OK;
                                        Close();
                                        Application.Exit();
                                    }
                                    catch (Exception applyEx)
                                    {
                                        FailUpdate("Failed to launch updater: " + applyEx.Message, tempDir);
                                    }
                                });
                            }
                        }
                        catch (Exception ex)
                        {
                            if (!IsDisposed && IsHandleCreated)
                            {
                                BeginInvoke((MethodInvoker)delegate()
                                {
                                    FailUpdate("Update verification/extraction failed: " + ex.Message, tempDir);
                                });
                            }
                        }
                    });
                    extractThread.IsBackground = true;
                    extractThread.Start();
                };

                client.DownloadFileAsync(new Uri(_info.ZipDownloadUrl), zipPath);
            }
            catch (Exception ex)
            {
                FailUpdate("Failed to start download: " + ex.Message, tempDir);
            }
        }

        private void FailUpdate(string message, string tempDir)
        {
            UpdateManager.AppendUpdateLog("Update failed: " + message);
            _isUpdating = false;
            _progressBar.Visible = false;
            _statusLabel.Size = new Size(480, 42);
            _statusLabel.ForeColor = Theme.Ember;
            _statusLabel.Text = message + " (See update.log)";
            _statusLabel.Visible = true;
            _updateNowButton.Enabled = true;
            _skipButton.Enabled = true;
            _closeButton.Enabled = true;

            try
            {
                if (!string.IsNullOrEmpty(tempDir) && Directory.Exists(tempDir))
                {
                    Directory.Delete(tempDir, true);
                }
            }
            catch
            {
                // Ignore temp cleanup failure.
            }
        }
    }
}
