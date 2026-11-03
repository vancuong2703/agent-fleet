using System.Text.Json;
using Microsoft.Win32;

namespace FleetDesktop;

internal sealed class DesktopPreferences(string dataDir)
{
    internal string Theme { get; private set; } = "light";
    internal DesktopLayout Layout { get; private set; } = new(258, 320, 380);
    internal void Load()
    {
        try
        {
            var file = Path.Combine(dataDir, "desktop-settings.json");
            if (!File.Exists(file)) return;
            using var document = JsonDocument.Parse(File.ReadAllText(file));
            if (document.RootElement.TryGetProperty("theme", out var savedTheme))
            {
                var theme = savedTheme.GetString();
                if (theme is "system" or "light" or "dark") Theme = theme;
            }
            if (document.RootElement.TryGetProperty("layout", out var layout)) Layout = ReadLayout(layout);
        }
        catch (Exception error) when (error is IOException or JsonException or KeyNotFoundException or InvalidOperationException) { }
    }
    internal void SetTheme(string theme)
    {
        if (theme is not ("system" or "light" or "dark")) throw new InvalidOperationException("Theme không hợp lệ.");
        Theme = theme;
        Save();
    }
    internal void SetLayout(JsonElement layout)
    {
        Layout = ReadLayout(layout);
        Save();
    }
    private static DesktopLayout ReadLayout(JsonElement layout)
    {
        static double Read(JsonElement source, string key, double fallback, double min, double max)
        {
            return source.ValueKind == JsonValueKind.Object && source.TryGetProperty(key, out var value)
                && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number) ? Math.Clamp(number, min, max) : fallback;
        }
        return new(Read(layout, "sidebarWidth", 258, 190, 420), Read(layout, "inspectorWidth", 320, 260, 520), Read(layout, "terminalHeight", 380, 240, 2000));
    }
    private void Save()
    {
        var temporary = Path.Combine(dataDir, "desktop-settings.json.tmp");
        File.WriteAllText(temporary, JsonSerializer.Serialize(new { theme = Theme, layout = Layout }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
        File.Move(temporary, Path.Combine(dataDir, "desktop-settings.json"), overwrite: true);
    }
    internal bool IsDark()
    {
        if (Theme != "system") return Theme == "dark";
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is int value && value == 0;
    }
}

internal sealed record DesktopLayout(double SidebarWidth, double InspectorWidth, double TerminalHeight);
