extends Node

var phase = 0
var hidden_order = ["live", "blank", "blank"]
var caption

func _ready():
	var translation = Translation.new()
	translation.locale = "en"
	translation.add_message("fixture.ready", "READY")
	TranslationServer.add_translation(translation)
	TranslationServer.set_locale("en")
	var ending = load("res://fixture/EndingManager.gd").new()
	add_child(ending)
	caption = Label.new()
	caption.text = "fixture.ready"
	add_child(caption)
	var literal = Label.new()
	literal.auto_translate = false
	literal.text = "fixture.ready"
	add_child(literal)
	var button = Button.new()
	button.modulate.a = 0
	add_child(button)
	var controller = load("res://fixture/ButtonClass.gd").new()
	controller.ui = caption
	button.add_child(controller)
	button.pressed.connect(Select)

func Select():
	var bridge = get_node("/root/CorticoBridge")
	match phase:
		0:
			bridge.ObserveLoad(hidden_order.count("live"), hidden_order.count("blank"))
			caption.text = "loaded"
		1:
			bridge.ObserveReveal(1, hidden_order[1], "magnifying glass")
			caption.text = "revealed"
		2:
			bridge.ObserveInverter()
			hidden_order[0] = "blank"
			bridge.ObserveEjection(hidden_order.pop_front(), false)
			caption.text = "ejected"
		3:
			bridge.ObserveOutcome("won", 100)
			caption.text = "result"
		4:
			get_tree().reload_current_scene()
	phase += 1
