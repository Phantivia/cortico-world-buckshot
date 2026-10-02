extends Node

var waitingForInput = false
var label_congrats = Label.new()
var uiparent = Control.new()
var cash_gl = 100

func _ready():
	add_child(uiparent)
	uiparent.add_child(label_congrats)
	label_congrats.text = "default visible ending resource"
