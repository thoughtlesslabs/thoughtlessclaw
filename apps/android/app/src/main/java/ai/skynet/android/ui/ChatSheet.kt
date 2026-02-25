package ai.skynet.android.ui

import androidx.compose.runtime.Composable
import ai.skynet.android.MainViewModel
import ai.skynet.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
