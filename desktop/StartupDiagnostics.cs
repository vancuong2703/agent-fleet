using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace FleetDesktop;

/// <summary>What the server wrote to startup-error.json (already redacted by the server).</summary>
internal sealed record StartupError(string Code, string Message, string Hint);

/// <summary>Turns a failed start into a message with the cause, never with secrets.</summary>
internal static class StartupDiagnostics
{
    internal const long MaxLogBytes = 2 * 1024 * 1024;
    internal const int TailLines = 12;

    internal static string ErrorFile(string dataDir) => Path.Combine(dataDir, "startup-error.json");
    internal static string LogFile(string dataDir) => Path.Combine(dataDir, "server.log");

    internal static StartupError? ReadStartupError(string dataDir)
    {
        try
        {
            var file = ErrorFile(dataDir);
            if (!File.Exists(file)) return null;
            using var document = JsonDocument.Parse(File.ReadAllText(file));
            var root = document.RootElement;
            string Text(string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
            // The server redacts, but the file is data on disk: mask again before it reaches a dialog.
            return new StartupError(Text("code"), Redact(Text("message")), Redact(Text("hint")));
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { return null; }
    }

    internal static void DeleteStartupError(string dataDir)
    {
        try { File.Delete(ErrorFile(dataDir)); } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    private static readonly Regex[] Secrets =
    [
        new(@"(?i)(x-fleet-token[""']?\s*[:=]\s*)[^\s,;""']+", RegexOptions.Compiled),
        new(@"\bsk-[A-Za-z0-9_\-]{6,}", RegexOptions.Compiled),
        new(@"\beyJ[A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)*", RegexOptions.Compiled),
        new(@"\b[0-9a-fA-F]{32,}\b", RegexOptions.Compiled),
    ];

    internal static string Redact(string text)
    {
        var result = Secrets[0].Replace(text, "$1***");
        for (var i = 1; i < Secrets.Length; i++) result = Secrets[i].Replace(result, "***");
        return result;
    }

    /// <summary>Last lines of server.log, redacted. Empty when there is no log.</summary>
    internal static string TailLog(string dataDir, int lines = TailLines)
    {
        try
        {
            var file = LogFile(dataDir);
            if (!File.Exists(file)) return "";
            using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var length = (int)Math.Min(stream.Length, 64 * 1024);
            stream.Seek(-length, SeekOrigin.End);
            var buffer = new byte[length];
            stream.ReadExactly(buffer);
            var tail = Encoding.UTF8.GetString(buffer).Split('\n').Select(line => line.TrimEnd('\r')).Where(line => line.Length > 0).TakeLast(lines);
            return Redact(string.Join(Environment.NewLine, tail));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return ""; }
    }

    /// <summary>server.log has no rotation: keep only the last 2 MB (called before the server starts).</summary>
    internal static void TrimLog(string logPath, long maxBytes = MaxLogBytes)
    {
        try
        {
            var info = new FileInfo(logPath);
            if (!info.Exists || info.Length <= maxBytes) return;
            byte[] keep;
            using (var stream = new FileStream(logPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                stream.Seek(-maxBytes, SeekOrigin.End);
                keep = new byte[maxBytes];
                stream.ReadExactly(keep);
            }
            File.WriteAllBytes(logPath, keep);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    /// <summary>Cause and hint when the server wrote one, otherwise the redacted log tail. Always names the log.</summary>
    internal static string Describe(string dataDir, string headline, string? detail)
    {
        var builder = new StringBuilder(headline);
        var error = ReadStartupError(dataDir);
        if (error != null)
        {
            builder.Append(Environment.NewLine).Append(Environment.NewLine).Append($"Nguyên nhân [{error.Code}]: {error.Message}");
            if (error.Hint.Length > 0) builder.Append(Environment.NewLine).Append($"Gợi ý: {error.Hint}");
        }
        else
        {
            if (!string.IsNullOrWhiteSpace(detail)) builder.Append(Environment.NewLine).Append(Redact(detail));
            var tail = TailLog(dataDir);
            if (tail.Length > 0) builder.Append(Environment.NewLine).Append(Environment.NewLine).Append("12 dòng cuối của server.log:").Append(Environment.NewLine).Append(tail);
        }
        builder.Append(Environment.NewLine).Append(Environment.NewLine).Append($"Log: {LogFile(dataDir)}");
        return builder.ToString();
    }
}
