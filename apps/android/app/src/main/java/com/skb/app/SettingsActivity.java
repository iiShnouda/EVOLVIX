package com.skb.app;

import android.app.Activity;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Server address: the cloud (default) or the company's own server on the office network. Plain
 * http:// works for an office server but is not encrypted, so a warning is shown for it.
 */
public class SettingsActivity extends Activity {
    private EditText input;
    private TextView warning;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        int pad = dp(20);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(R.string.settings_title);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText(R.string.settings_hint);
        hint.setPadding(0, dp(8), 0, dp(12));
        root.addView(hint);

        input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setTextDirection(android.view.View.TEXT_DIRECTION_LTR);
        input.setText(ServerConfig.get(this));
        root.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        warning = new TextView(this);
        warning.setTextColor(0xFFB45309);
        warning.setText(R.string.settings_http_warning);
        warning.setPadding(0, dp(6), 0, 0);
        root.addView(warning);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.END);
        buttons.setPadding(0, dp(16), 0, 0);

        Button reset = new Button(this);
        reset.setText(R.string.settings_default);
        reset.setOnClickListener(v -> input.setText(ServerConfig.DEFAULT_URL));
        buttons.addView(reset);

        Button save = new Button(this);
        save.setText(R.string.save);
        save.setOnClickListener(v -> save());
        buttons.addView(save);
        root.addView(buttons);

        input.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) { updateWarning(); }
        });
        updateWarning();
        setContentView(root);
    }

    private void updateWarning() {
        String url = ServerConfig.normalize(input.getText().toString());
        warning.setVisibility(url != null && url.startsWith("http://") ? TextView.VISIBLE : TextView.GONE);
    }

    private void save() {
        String url = ServerConfig.normalize(input.getText().toString());
        if (url == null) {
            Toast.makeText(this, R.string.settings_invalid, Toast.LENGTH_LONG).show();
            return;
        }
        ServerConfig.set(this, url);
        setResult(RESULT_OK);
        finish();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
