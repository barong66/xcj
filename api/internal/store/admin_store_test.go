package store

import "testing"

func TestUpdateAccountInput_ChatFields(t *testing.T) {
	var input UpdateAccountInput
	chatEnabled := true
	prompt := "custom prompt"
	adText := "check my OF"

	input.ChatEnabled = &chatEnabled
	input.ChatPrompt = &prompt
	input.ChatAdText = &adText

	if input.ChatEnabled == nil || *input.ChatEnabled != true {
		t.Error("ChatEnabled field missing or wrong value")
	}
	if input.ChatPrompt == nil || *input.ChatPrompt != "custom prompt" {
		t.Error("ChatPrompt field missing or wrong value")
	}
	if input.ChatAdText == nil || *input.ChatAdText != "check my OF" {
		t.Error("ChatAdText field missing or wrong value")
	}
}
