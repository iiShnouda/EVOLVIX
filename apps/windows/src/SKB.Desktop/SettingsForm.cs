using System.Drawing;
using System.Windows.Forms;
using Text_ = SKB.Desktop.Text; // Form.Text is the window title

namespace SKB.Desktop;

/// <summary>Server address dialog: the cloud (default) or the company server on the office network.</summary>
internal sealed class SettingsForm : Form
{
    private readonly TextBox _address = new() { Width = 420, RightToLeft = RightToLeft.No };
    private readonly Label _warning = new() { AutoSize = true, ForeColor = Color.FromArgb(180, 83, 9) };

    public SettingsForm()
    {
        Text = Text_.SettingsTitle;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(16);
        Font = new Font("Segoe UI", 10f);
        if (Text_.Arabic)
        {
            RightToLeft = RightToLeft.Yes;
            RightToLeftLayout = true;
        }

        var layout = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false };
        layout.Controls.Add(new Label { Text = Text_.SettingsHint, AutoSize = true, MaximumSize = new Size(440, 0) });
        _address.Text = AppSettings.Server;
        _address.TextChanged += (_, _) => UpdateWarning();
        layout.Controls.Add(_address);
        _warning.Text = Text_.HttpWarning;
        layout.Controls.Add(_warning);

        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, AutoSize = true, Margin = new Padding(0, 12, 0, 0) };
        var save = new Button { Text = Text_.Save, AutoSize = true, DialogResult = DialogResult.None };
        save.Click += (_, _) => Save();
        var reset = new Button { Text = Text_.Default, AutoSize = true };
        reset.Click += (_, _) => _address.Text = AppSettings.DefaultServer;
        var cancel = new Button { Text = Text_.Cancel, AutoSize = true, DialogResult = DialogResult.Cancel };
        buttons.Controls.AddRange(new Control[] { save, reset, cancel });
        layout.Controls.Add(buttons);

        Controls.Add(layout);
        AcceptButton = save;
        CancelButton = cancel;
        UpdateWarning();
    }

    private void UpdateWarning()
    {
        var url = AppSettings.Normalize(_address.Text);
        _warning.Visible = url is not null && url.StartsWith("http://");
    }

    private void Save()
    {
        var url = AppSettings.Normalize(_address.Text);
        if (url is null)
        {
            MessageBox.Show(this, Text_.Invalid, Text_.SettingsTitle);
            return;
        }
        AppSettings.Server = url;
        DialogResult = DialogResult.OK;
        Close();
    }
}
