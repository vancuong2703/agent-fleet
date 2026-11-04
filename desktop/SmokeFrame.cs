using System.Text.Json;

namespace FleetDesktop;

/// <summary>
/// Pure helper for the native CLI smoke test. The previous check matched any
/// visible <c>.terminal-session</c> and the previous CLI's text, so a tab that
/// had not drawn yet was still reported as rendered. This evaluator requires
/// the EXPECTED agent's tab/caption, a connected socket, a readable frame and
/// (through <see cref="IsSettled"/>) the same frame twice in a row.
/// </summary>
internal sealed record CliFrameState(bool Ready, int Lines, string Signature, string TabLabel);

internal static class SmokeFrame
{
    internal const string ConnectedLabel = "Đã kết nối";
    /// <summary>A transient loading line alone must never count as a frame.</summary>
    internal const int MinimumLines = 2;
    internal const int MinimumLetters = 8;

    /// <summary>DOM snapshot script; returns only counts/hashes, never terminal text.</summary>
    internal static string SnapshotScript(string title)
    {
        var expected = JsonSerializer.Serialize(title);
        return """
        (()=>{
          const title=__TITLE__;
          const tabs=Array.from(document.querySelectorAll('[role="tab"]'));
          const active=tabs.find(tab=>tab.getAttribute('aria-selected')==='true')??null;
          const label=(active?.textContent??'').replace(/\s+/g,' ').trim();
          const panel=document.querySelector('.terminal-session:not([hidden])');
          const caption=(panel?.querySelector('.terminal-caption')?.textContent??'').replace(/\s+/g,' ').trim();
          const conn=(panel?.querySelector('.terminal-connection')?.textContent??'').trim();
          const rows=panel?.querySelector('.xterm-rows')?.innerText??'';
          const lines=rows.split('\n').filter(line=>line.trim().length>0);
          const letters=(rows.match(/[A-Za-z]/g)??[]).length;
          let hash=0;
          for(let i=0;i<rows.length;i++) hash=(hash*31+rows.charCodeAt(i))|0;
          return {label,caption,conn,lines:lines.length,letters,textLen:rows.length,hash};
        })()
        """.Replace("__TITLE__", expected);
    }

    internal static CliFrameState Evaluate(string title, string snapshotJson)
    {
        var notReady = new CliFrameState(false, 0, string.Empty, string.Empty);
        try
        {
            using var document = JsonDocument.Parse(snapshotJson);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return notReady;
            var label = root.GetProperty("label").GetString() ?? string.Empty;
            var caption = root.GetProperty("caption").GetString() ?? string.Empty;
            var connection = root.GetProperty("conn").GetString() ?? string.Empty;
            var lines = root.GetProperty("lines").GetInt32();
            var letters = root.GetProperty("letters").GetInt32();
            var textLength = root.GetProperty("textLen").GetInt32();
            var hash = root.GetProperty("hash").GetInt32();
            var matches = label.Contains(title, StringComparison.Ordinal) && caption.StartsWith(title, StringComparison.Ordinal);
            var ready = matches && connection == ConnectedLabel && lines >= MinimumLines && letters >= MinimumLetters && textLength > 0;
            return new CliFrameState(ready, lines, $"{textLength}:{hash}:{lines}", label);
        }
        catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return notReady;
        }
    }

    /// <summary>The same readable frame twice; a growing or loading frame is not settled.</summary>
    internal static bool IsSettled(CliFrameState previous, CliFrameState current) =>
        previous.Ready && current.Ready && previous.Signature == current.Signature;
}
