using System.Text.Json;
using Microsoft.Win32;

namespace FleetDesktop;

internal sealed class DesktopPreferences(string dataDir)
{
    internal string Theme { get; private set; } = "light";
    internal DesktopLayout Layout { get; private set; } = new(258, 320, 380);
    internal DesktopAppearance Appearance { get; private set; } = new();

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
            if (document.RootElement.TryGetProperty("appearance", out var appearance)) Appearance = ReadAppearance(appearance);
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
    internal void SetAppearance(JsonElement appearance)
    {
        Appearance = ReadAppearance(appearance);
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
    private static DesktopAppearance ReadAppearance(JsonElement source)
    {
        if (source.ValueKind != JsonValueKind.Object) return new();
        static string Read(JsonElement obj, string key, string fallback, params string[] allowed)
        {
            if (obj.TryGetProperty(key, out var val) && val.ValueKind == JsonValueKind.String)
            {
                var s = val.GetString();
                if (s != null && allowed.Contains(s)) return s;
            }
            return fallback;
        }
        var style = Read(source, "style", "plain", "plain", "warm");
        var font = Read(source, "font", "system", "system", "inter", "bricolage");
        var size = Read(source, "size", "standard", "standard", "large");
        var motion = Read(source, "motion", "system", "system", "reduced", "off");
        return new(style, font, size, motion);
    }
    private void Save()
    {
        var temporary = Path.Combine(dataDir, "desktop-settings.json.tmp");
        File.WriteAllText(temporary, JsonSerializer.Serialize(new { theme = Theme, layout = Layout, appearance = Appearance }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
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
internal sealed record DesktopAppearance(string Style = "plain", string Font = "system", string Size = "standard", string Motion = "system");
